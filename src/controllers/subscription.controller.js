import mongoose, { isValidObjectId } from "mongoose";
import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.models.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// POST /api/v1/subscriptions/c/:channelId
const toggleSubscription = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) throw new ApiError(400, "Invalid channelId");
    if (channelId === req.user._id.toString()) {
        throw new ApiError(400, "You cannot subscribe to yourself");
    }

    const channel = await User.findById(channelId);
    if (!channel) throw new ApiError(404, "Channel not found");

    const existing = await Subscription.findOne({
        subscriber: req.user._id,
        channel: channelId
    });

    if (existing) {
        await Subscription.findByIdAndDelete(existing._id);
        return res
            .status(200)
            .json(new ApiResponse(200, { subscribed: false }, "Unsubscribed successfully"));
    }

    await Subscription.create({ subscriber: req.user._id, channel: channelId });

    return res
        .status(200)
        .json(new ApiResponse(200, { subscribed: true }, "Subscribed successfully"));
});

// GET /api/v1/subscriptions/c/:channelId — list of subscribers for a channel
const getUserChannelSubscribers = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) throw new ApiError(400, "Invalid channelId");

    const subscribers = await Subscription.aggregate([
        { $match: { channel: new mongoose.Types.ObjectId(channelId) } },
        {
            $lookup: {
                from: "users",
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriber",
                pipeline: [{ $project: { username: 1, avatar: 1, fullName: 1 } }]
            }
        },
        { $unwind: "$subscriber" },
        { $replaceRoot: { newRoot: "$subscriber" } }
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, subscribers, "Subscribers fetched successfully"));
});

// GET /api/v1/subscriptions/u/:subscriberId — list of channels a user is subscribed to
const getSubscribedChannels = asyncHandler(async (req, res) => {
    const { subscriberId } = req.params;

    if (!isValidObjectId(subscriberId)) throw new ApiError(400, "Invalid subscriberId");

    const channels = await Subscription.aggregate([
        { $match: { subscriber: new mongoose.Types.ObjectId(subscriberId) } },
        {
            $lookup: {
                from: "users",
                localField: "channel",
                foreignField: "_id",
                as: "channel",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "channelSubscribers"
                        }
                    },
                    {
                        $addFields: {
                            subscribersCount: { $size: "$channelSubscribers" },
                            isSubscribed: {
                                $cond: {
                                    if: { $in: [req.user?._id, "$channelSubscribers.subscriber"] },
                                    then: true,
                                    else: false
                                }
                            }
                        }
                    },
                    { $project: { username: 1, avatar: 1, fullName: 1, subscribersCount: 1, isSubscribed: 1 } }
                ]
            }
        },
        { $unwind: "$channel" },
        { $replaceRoot: { newRoot: "$channel" } }
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, channels, "Subscribed channels fetched successfully"));
});

export { toggleSubscription, getUserChannelSubscribers, getSubscribedChannels };
