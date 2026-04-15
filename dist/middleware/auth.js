"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
/**
 * Validates a user JWT by calling the ReZ Auth service.
 * Sets req.userId, req.userRole, and req.userPermissions on success.
 * Returns 401 if the token is missing, invalid, or the auth service is unreachable.
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'No token provided' });
        return;
    }
    const token = authHeader.slice(7);
    try {
        const response = await axios_1.default.post(`${config_1.authServiceUrl}/api/auth/verify`, { token }, { timeout: 5000 });
        req.userId = response.data.userId;
        req.userRole = response.data.role;
        req.userPermissions = response.data.permissions;
        next();
    }
    catch (err) {
        const axiosErr = err;
        if (axiosErr.response?.status === 401) {
            res.status(401).json({ success: false, message: 'Invalid token' });
            return;
        }
        res.status(503).json({
            success: false,
            message: 'Authentication service unavailable',
        });
    }
}
//# sourceMappingURL=auth.js.map