import mongoose, { isValidObjectId } from "mongoose";
import { Like } from "../models/like.model.js";
import { Video } from "../models/video.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// POST /api/v1/likes/toggle/v/:videoId
const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid videoId");

    const video = await Video.findById(videoId);
    if (!video) throw new ApiError(404, "Video not found");

    const existingLike = await Like.findOne({ video: videoId, likedBy: req.user._id });

    if (existingLike) {
        await Like.findByIdAndDelete(existingLike._id);
        return res
            .status(200)
            .json(new ApiResponse(200, { liked: false }, "Video unliked"));
    }

    await Like.create({ video: videoId, likedBy: req.user._id });

    return res
        .status(200)
        .json(new ApiResponse(200, { liked: true }, "Video liked"));
});

// POST /api/v1/likes/toggle/c/:commentId
const toggleCommentLike = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!isValidObjectId(commentId)) throw new ApiError(400, "Invalid commentId");

    const existingLike = await Like.findOne({ comment: commentId, likedBy: req.user._id });

    if (existingLike) {
        await Like.findByIdAndDelete(existingLike._id);
        return res
            .status(200)
            .json(new ApiResponse(200, { liked: false }, "Comment unliked"));
    }

    await Like.create({ comment: commentId, likedBy: req.user._id });

    return res
        .status(200)
        .json(new ApiResponse(200, { liked: true }, "Comment liked"));
});

// POST /api/v1/likes/toggle/t/:tweetId
const toggleTweetLike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!isValidObjectId(tweetId)) throw new ApiError(400, "Invalid tweetId");

    const existingLike = await Like.findOne({ tweet: tweetId, likedBy: req.user._id });

    if (existingLike) {
        await Like.findByIdAndDelete(existingLike._id);
        return res
            .status(200)
            .json(new ApiResponse(200, { liked: false }, "Tweet unliked"));
    }

    await Like.create({ tweet: tweetId, likedBy: req.user._id });

    return res
        .status(200)
        .json(new ApiResponse(200, { liked: true }, "Tweet liked"));
});

// GET /api/v1/likes/videos
const getLikedVideos = asyncHandler(async (req, res) => {
    const likedVideos = await Like.aggregate([
        { $match: { likedBy: new mongoose.Types.ObjectId(req.user._id), video: { $exists: true } } },
        {
            $lookup: {
                from: "videos",
                localField: "video",
                foreignField: "_id",
                as: "video",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [{ $project: { username: 1, avatar: 1 } }]
                        }
                    },
                    { $unwind: "$owner" },
                    { $match: { isPublished: true } }
                ]
            }
        },
        { $unwind: "$video" },
        { $replaceRoot: { newRoot: "$video" } },
        { $sort: { createdAt: -1 } }
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, likedVideos, "Liked videos fetched successfully"));
});

export { toggleVideoLike, toggleCommentLike, toggleTweetLike, getLikedVideos };
