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
exports.EarnRecord = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const verificationSignalsSchema = new mongoose_1.Schema({
    qr_in: { type: Boolean, default: false },
    qr_out: { type: Boolean, default: false },
    gps_match: { type: Number, default: 0 },
    ngo_approved: { type: Boolean, default: false },
    photo_proof: { type: Boolean, default: false },
}, { _id: false });
const EarnRecordSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    bookingId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'EventBooking', required: true },
    karmaEarned: { type: Number, required: true, min: 0 },
    activeLevelAtApproval: {
        type: String,
        enum: ['L1', 'L2', 'L3', 'L4'],
        required: true,
    },
    conversionRateSnapshot: { type: Number, required: true, min: 0, max: 1 },
    csrPoolId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'CSRPool', required: true },
    verificationSignals: { type: verificationSignalsSchema, required: true },
    confidenceScore: { type: Number, required: true, min: 0, max: 1 },
    status: {
        type: String,
        enum: [
            'APPROVED_PENDING_CONVERSION',
            'CONVERTED',
            'REJECTED',
            'ROLLED_BACK',
        ],
        default: 'APPROVED_PENDING_CONVERSION',
        index: true,
    },
    createdAt: { type: Date, default: Date.now, index: true },
    approvedAt: { type: Date },
    convertedAt: { type: Date },
    convertedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    batchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Batch', index: true },
    rezCoinsEarned: { type: Number, min: 0 },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
}, {
    timestamps: false,
    collection: 'earn_records',
});
exports.EarnRecord = mongoose_1.default.models.EarnRecord ||
    mongoose_1.default.model('EarnRecord', EarnRecordSchema);
//# sourceMappingURL=EarnRecord.js.map