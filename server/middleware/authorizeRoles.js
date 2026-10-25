const applicationRoles = new Set(["Admin", "HR", "Employee"]);

export function authorizeRoles(...allowedRoles) {
  if (allowedRoles.length === 0 || allowedRoles.some((role) => !applicationRoles.has(role))) {
    throw new TypeError("One or more valid application roles are required");
  }

  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required" }
      });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "You do not have permission to access this resource" }
      });
    }

    return next();
  };
}
