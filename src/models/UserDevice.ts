// @ts-nocheck
// @ts-ignore
/**
 * UserDevice Model — FCM device token storage for push notifications
 *
 * Stores one active device per user for push notification delivery.
 * Users can have multiple devices, but we track the most recently active one.
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface IUserDevice {
  userId: mongoose.Types.ObjectId;
  fcmToken: string;
  platform: DevicePlatform;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDeviceDocument extends Omit<IUserDevice, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

interface UserDeviceModel extends Model<UserDeviceDocument> {
  updateToken(userId: mongoose.Types.ObjectId | string, fcmToken: string, platform?: DevicePlatform): Promise<UserDeviceDocument>;
  deleteToken(userId: mongoose.Types.ObjectId | string): Promise<boolean>;
  getActiveDevice(userId: mongoose.Types.ObjectId | string): Promise<UserDeviceDocument | null>;
}

const UserDeviceSchema = new Schema<UserDeviceDocument, UserDeviceModel>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // One active device per user
      index: true,
    },
    fcmToken: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      required: true,
      enum: ['ios', 'android', 'web'] as DevicePlatform[],
      default: 'android',
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'user_devices',
  },
);

// Compound index for querying devices by platform
UserDeviceSchema.index({ platform: 1, lastActive: -1 });

// ── Static Methods ────────────────────────────────────────────────────────────

/**
 * Update or create a device token for a user.
 * Creates a new record if none exists, or updates the existing one.
 */
UserDeviceSchema.statics.updateToken = async function (
  userId: mongoose.Types.ObjectId | string,
  fcmToken: string,
  platform: DevicePlatform = 'android',
): Promise<UserDeviceDocument> {
  const userOid = typeof userId === 'string'
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const device = await this.findOneAndUpdate(
    { userId: userOid },
    {
      $set: {
        fcmToken,
        platform,
        lastActive: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  return device;
};

/**
 * Delete the device token for a user (unregister).
 */
UserDeviceSchema.statics.deleteToken = async function (
  userId: mongoose.Types.ObjectId | string,
): Promise<boolean> {
  const userOid = typeof userId === 'string'
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const result = await this.deleteOne({ userId: userOid });
  return result.deletedCount > 0;
};

/**
 * Get the most recently active device for a user.
 */
UserDeviceSchema.statics.getActiveDevice = async function (
  userId: mongoose.Types.ObjectId | string,
): Promise<UserDeviceDocument | null> {
  const userOid = typeof userId === 'string'
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  return this.findOne({ userId: userOid }).sort({ lastActive: -1 }).lean() as Promise<UserDeviceDocument | null>;
};

export const UserDevice: UserDeviceModel =
  (mongoose.models.UserDevice as UserDeviceModel) ||
  mongoose.model<UserDeviceDocument, UserDeviceModel>('UserDevice', UserDeviceSchema);
