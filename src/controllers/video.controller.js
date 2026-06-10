import mongoose, { isValidObjectId } from "mongoose";
import { Video } from "../models/video.model.js";
import { User } from "../models/user.models.js";
import { Like } from "../models/like.model.js";
import { Comment } from "../models/comment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

// Helper: extract cloudinary public_id from url
const getPublicId = (url) => {
    if (!url) return null;
    const parts = url.split("/");
    const filename = parts[parts.length - 1];
    return filename.split(".")[0];
};

// GET /api/v1/videos?page=1&limit=10&query=&sortBy=createdAt&sortType=desc&userId=
const getAllVideos = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        query,
        sortBy = "createdAt",
        sortType = "desc",
        userId
    } = req.query;

    const pipeline = [];

    if (query) {
        pipeline.push({
            $match: {
                $or: [
                    { title: { $regex: query, $options: "i" } },
                    { description: { $regex: query, $options: "i" } }
                ]
            }
        });
    }

    if (userId) {
        if (!isValidObjectId(userId)) throw new ApiError(400, "Invalid userId");
        pipeline.push({ $match: { owner: new mongoose.Types.ObjectId(userId) } });
    }

    pipeline.push({ $match: { isPublished: true } });

    pipeline.push({ $sort: { [sortBy]: sortType === "asc" ? 1 : -1 } });

    pipeline.push({
        $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "ownerDetails",
            pipeline: [{ $project: { username: 1, avatar: 1 } }]
        }
    });

    pipeline.push({ $unwind: "$ownerDetails" });

    const videoAggregate = Video.aggregate(pipeline);
    const options = { page: parseInt(page, 10), limit: parseInt(limit, 10) };
    const videos = await Video.aggregatePaginate(videoAggregate, options);

    return res
        .status(200)
        .json(new ApiResponse(200, videos, "Videos fetched successfully"));
});

// POST /api/v1/videos
const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    if (!title?.trim() || !description?.trim()) {
        throw new ApiError(400, "Title and description are required");
    }

    const videoFileLocalPath = req.files?.videoFile?.[0]?.path;
    const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;

    if (!videoFileLocalPath) throw new ApiError(400, "Video file is required");
    if (!thumbnailLocalPath) throw new ApiError(400, "Thumbnail is required");

    const videoFile = await uploadOnCloudinary(videoFileLocalPath);
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

    if (!videoFile) throw new ApiError(400, "Error uploading video file");
    if (!thumbnail) throw new ApiError(400, "Error uploading thumbnail");

    const video = await Video.create({
        videoFile: videoFile.url,
        thumbnail: thumbnail.url,
        title: title.trim(),
        description: description.trim(),
        duration: videoFile.duration || 0,
        owner: req.user._id,
        isPublished: true
    });

    return res
        .status(201)
        .json(new ApiResponse(201, video, "Video published successfully"));
});

// GET /api/v1/videos/:videoId
const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid videoId");

    const video = await Video.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(videoId) } },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "subscribers"
                        }
                    },
                    {
                        $addFields: {
                            subscribersCount: { $size: "$subscribers" },
                            isSubscribed: {
                                $cond: {
                                    if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                                    then: true,
                                    else: false
                                }
                            }
                        }
                    },
                    { $project: { username: 1, avatar: 1, subscribersCount: 1, isSubscribed: 1 } }
                ]
            }
        },
        {
            $addFields: {
                likesCount: { $size: "$likes" },
                owner: { $first: "$owner" },
                isLiked: {
                    $cond: {
                        if: { $in: [req.user?._id, "$likes.likedBy"] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                videoFile: 1, thumbnail: 1, title: 1, description: 1,
                views: 1, createdAt: 1, duration: 1, isPublished: 1,
                owner: 1, likesCount: 1, isLiked: 1
            }
        }
    ]);

    if (!video?.length) throw new ApiError(404, "Video not found");

    // Increment views & add to watch history
    await Video.findByIdAndUpdate(videoId, { $inc: { views: 1 } });
    await User.findByIdAndUpdate(req.user?._id, { $addToSet: { watchHistory: videoId } });

    return res
        .status(200)
        .json(new ApiResponse(200, video[0], "Video fetched successfully"));
});

// PATCH /api/v1/videos/:videoId
const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { title, description } = req.body;

    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid videoId");
    if (!title?.trim() || !description?.trim()) {
        throw new ApiError(400, "Title and description are required");
    }

    const video = await Video.findById(videoId);
    if (!video) throw new ApiError(404, "Video not found");

    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not authorized to update this video");
    }

    let thumbnailUrl = video.thumbnail;
    const thumbnailLocalPath = req.file?.path;

    if (thumbnailLocalPath) {
        const oldPublicId = getPublicId(video.thumbnail);
        if (oldPublicId) await deleteFromCloudinary(oldPublicId);
        const newThumbnail = await uploadOnCloudinary(thumbnailLocalPath);
        if (!newThumbnail) throw new ApiError(400, "Error uploading thumbnail");
        thumbnailUrl = newThumbnail.url;
    }

    const updatedVideo = await Video.findByIdAndUpdate(
        videoId,
        { $set: { title: title.trim(), description: description.trim(), thumbnail: thumbnailUrl } },
        { new: true }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, updatedVideo, "Video updated successfully"));
});

// DELETE /api/v1/videos/:videoId
const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid videoId");

    const video = await Video.findById(videoId);
    if (!video) throw new ApiError(404, "Video not found");

    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not authorized to delete this video");
    }

    await Video.findByIdAndDelete(videoId);

    // Cleanup cloudinary
    const videoPublicId = getPublicId(video.videoFile);
    const thumbPublicId = getPublicId(video.thumbnail);
    if (videoPublicId) await deleteFromCloudinary(videoPublicId, "video");
    if (thumbPublicId) await deleteFromCloudinary(thumbPublicId);

    // Cleanup related data
    await Like.deleteMany({ video: videoId });
    await Comment.deleteMany({ video: videoId });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video deleted successfully"));
});

// PATCH /api/v1/videos/toggle/publish/:videoId
const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid videoId");

    const video = await Video.findById(videoId);
    if (!video) throw new ApiError(404, "Video not found");

    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not authorized to toggle publish status");
    }

    const updated = await Video.findByIdAndUpdate(
        videoId,
        { $set: { isPublished: !video.isPublished } },
        { new: true }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, { isPublished: updated.isPublished }, "Publish status toggled successfully"));
});

export {
    getAllVideos,
    publishAVideo,
    getVideoById,
    updateVideo,
    deleteVideo,
    togglePublishStatus
};
