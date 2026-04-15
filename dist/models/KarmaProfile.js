"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.KarmaProfile = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const BadgeSchema = new mongoose_1.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    earnedAt: { type: Date, required: true },
}, { _id: false });
const LevelHistoryEntrySchema = new mongoose_1.Schema({
    level: { type: String, enum: ['L1', 'L2', 'L3', 'L4'], required: true },
    earnedAt: { type: Date, required: true },
    droppedAt: { type: Date },
}, { _id: false });
const ConversionHistoryEntrySchema = new mongoose_1.Schema({
    karmaConverted: { type: Number, required: true, min: 0 },
    coinsEarned: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0, max: 1 },
    batchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Batch', required: true },
    convertedAt: { type: Date, required: true },
}, { _id: false });
const KarmaProfileSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },
    lifetimeKarma: { type: Number, default: 0, min: 0 },
    activeKarma: { type: Number, default: 0, min: 0 },
    level: {
        type: String,
        enum: ['L1', 'L2', 'L3', 'L4'],
        default: 'L1',
    },
    eventsCompleted: { type: Number, default: 0, min: 0 },
    eventsJoined: { type: Number, default: 0, min: 0 },
    totalHours: { type: Number, default: 0, min: 0 },
    trustScore: { type: Number, default: 0, min: 0, max: 100 },
    badges: { type: [BadgeSchema], default: [] },
    lastActivityAt: { type: Date, default: null },
    levelHistory: { type: [LevelHistoryEntrySchema], default: [] },
    conversionHistory: { type: [ConversionHistoryEntrySchema], default: [] },
    thisWeekKarmaEarned: { type: Number, default: 0 },
    weekOfLastKarmaEarned: { type: Date },
    avgEventDifficulty: { type: Number, default: 0 },
    avgConfidenceScore: { type: Number, default: 0 },
    checkIns: { type: Number, default: 0 },
    approvedCheckIns: { type: Number, default: 0 },
    activityHistory: { type: [Date], default: [] },
    createdAt: { type: Date, default: Date.now },
}, {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'karma_profiles',
});
exports.KarmaProfile = mongoose_1.default.models.KarmaProfile ||
    mongoose_1.default.model('KarmaProfile', KarmaProfileSchema);
//# sourceMappingURL=KarmaProfile.js.map