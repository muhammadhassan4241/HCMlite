import { verifyAccessToken } from "../utils/jwt.js";
import User from "../models/User.js";

export function authenticateToken(jwtSecret, userModel = User) {
  return async (req, res, next) => {
    const authorization = req.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required" }
      });
    }

    let identity;
    try {
      identity = verifyAccessToken(match[1], jwtSecret);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_TOKEN", message: "The access token is invalid or expired" }
      });
    }

    try {
      const user = await userModel.findById(identity.userId).select("-passwordHash");
      if (!user || user.status !== "active") {
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHENTICATED", message: "The account is unavailable" }
        });
      }

      req.auth = { userId: String(user._id), role: user.role };
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
