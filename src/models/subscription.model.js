import mongoose, { Schema } from "mongoose";

const subscriptionSchema = new Schema(
    {
        subscriber: { type: Schema.Types.ObjectId, ref: "User" }, // person who is subscribing
        channel:    { type: Schema.Types.ObjectId, ref: "User" }  // channel being subscribed to
    },
    { timestamps: true }
);

export const Subscription = mongoose.model("Subscription", subscriptionSchema);
