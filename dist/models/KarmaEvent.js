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
exports.KarmaEvent = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const qrCodesSchema = new mongoose_1.Schema({
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
}, { _id: false });
const KarmaEventSchema = new mongoose_1.Schema({
    merchantEventId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Event',
        required: true,
        index: true,
    },
    ngoId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    category: {
        type: String,
        enum: ['environment', 'food', 'health', 'education', 'community'],
        required: true,
    },
    impactUnit: { type: String, required: true },
    impactMultiplier: { type: Number, default: 1.0, min: 0 },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        required: true,
    },
    expectedDurationHours: { type: Number, required: true, min: 0 },
    baseKarmaPerHour: { type: Number, required: true, min: 0 },
    maxKarmaPerEvent: { type: Number, required: true, min: 0 },
    qrCodes: { type: qrCodesSchema, required: true },
    gpsRadius: { type: Number, default: 100, min: 0 },
    maxVolunteers: { type: Number, default: 50, min: 1 },
    confirmedVolunteers: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        enum: ['draft', 'published', 'ongoing', 'completed', 'cancelled'],
        default: 'draft',
        index: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, {
    timestamps: true,
    collection: 'karma_events',
});
exports.KarmaEvent = mongoose_1.default.models.KarmaEvent ||
    mongoose_1.default.model('KarmaEvent', KarmaEventSchema);
//# sourceMappingURL=KarmaEvent.js.map