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
exports.CSRPool = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const CSRPoolSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    campaignId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    corporateId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'CorporateAccount', required: true, index: true },
    totalBudget: { type: Number, required: true, min: 0 },
    remainingBudget: { type: Number, default: 0, min: 0 },
    coinPool: { type: Number, required: true, min: 0 },
    coinPoolRemaining: { type: Number, default: 0, min: 0 },
    issuedCoins: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        enum: ['active', 'depleted', 'expired'],
        default: 'active',
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    events: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Event' }],
    createdAt: { type: Date, default: Date.now },
}, {
    timestamps: false,
    collection: 'csr_pools',
});
exports.CSRPool = mongoose_1.default.models.CSRPool ||
    mongoose_1.default.model('CSRPool', CSRPoolSchema);
//# sourceMappingURL=CSRPool.js.map