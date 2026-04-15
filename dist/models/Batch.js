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
exports.Batch = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const anomalyFlagSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: ['too_many_from_one_ngo', 'suspicious_timestamps', 'pool_shortage'],
        required: true,
    },
    count: { type: Number, default: 0, min: 0 },
    resolved: { type: Boolean, default: false },
}, { _id: false });
const BatchSchema = new mongoose_1.Schema({
    weekStart: { type: Date, required: true, index: true },
    weekEnd: { type: Date, required: true },
    csrPoolId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'CSRPool', required: true },
    totalEarnRecords: { type: Number, default: 0, min: 0 },
    totalKarma: { type: Number, default: 0, min: 0 },
    totalRezCoinsEstimated: { type: Number, default: 0, min: 0 },
    totalRezCoinsExecuted: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        enum: ['DRAFT', 'READY', 'EXECUTED', 'PARTIAL', 'PAUSED'],
        default: 'DRAFT',
        index: true,
    },
    anomalyFlags: [anomalyFlagSchema],
    executedAt: { type: Date },
    executedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    pauseReason: { type: String },
    pausedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'batches',
});
exports.Batch = mongoose_1.default.models.Batch ||
    mongoose_1.default.model('Batch', BatchSchema);
//# sourceMappingURL=Batch.js.map