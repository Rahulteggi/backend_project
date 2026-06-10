import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Like } from "../models/like.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// GET /api/v1/dashboard/stats
const getChannelStats = asyncHandler(async (req, res) => {
    const channelId = req.user._id;

    const [videoStats] = await Video.aggregate([
        { $match: { owner: new mongoose.Types.ObjectId(channelId) } },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $group: {
                _id: null,
                totalVideos: { $sum: 1 },
                totalViews: { $sum: "$views" },
                totalLikes: { $sum: { $size: "$likes" } }
            }
        }
    ]);

    const totalSubscribers = await Subscription.countDocuments({ channel: channelId });

    const stats = {
        totalSubscribers,
        totalVideos: videoStats?.totalVideos || 0,
        totalViews: videoStats?.totalViews || 0,
        totalLikes: videoStats?.totalLikes || 0
    };

    return res
        .status(200)
        .json(new ApiResponse(200, stats, "Channel stats fetched successfully"));
});

// GET /api/v1/dashboard/videos
const getChannelVideos = asyncHandler(async (req, res) => {
    const channelId = req.user._id;

    const videos = await Video.aggregate([
        { $match: { owner: new mongoose.Types.ObjectId(channelId) } },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $addFields: {
                likesCount: { $size: "$likes" }
            }
        },
        { $sort: { createdAt: -1 } },
        {
            $project: {
                _id: 1,
                title: 1,
                thumbnail: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                likesCount: 1,
                duration: 1
            }
        }
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, videos, "Channel videos fetched successfully"));
});

export { getChannelStats, getChannelVideos };
