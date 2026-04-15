"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminAuth = requireAdminAuth;
const auth_1 = require("./auth");
/**
 * Extends requireAuth: verifies the user has an admin role.
 * Must be used after requireAuth so req.userRole is populated.
 * Returns 403 if the user is authenticated but not an admin.
 */
async function requireAdminAuth(req, res, next) {
    await new Promise((resolve, reject) => {
        (0, auth_1.requireAuth)(req, res, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
    const adminRoles = ['admin', 'superadmin'];
    if (!req.userRole || !adminRoles.includes(req.userRole)) {
        res.status(403).json({
            success: false,
            message: 'Admin access required',
        });
        return;
    }
    next();
}
//# sourceMappingURL=adminAuth.js.map