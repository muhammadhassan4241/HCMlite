import mongoose from "mongoose";

export function requireCompanyContext(companyModel) {
  return async (req, res, next) => {
    const companyId = req.user?.companyId;
    if (!companyId || !mongoose.isObjectIdOrHexString(companyId)) {
      return res.status(403).json({
        success: false,
        error: { code: "COMPANY_CONTEXT_REQUIRED", message: "An assigned company is required" }
      });
    }

    try {
      const company = await companyModel.findById(companyId);
      if (!company) {
        return res.status(403).json({
          success: false,
          error: { code: "COMPANY_CONTEXT_REQUIRED", message: "An assigned company is required" }
        });
      }

      req.company = company;
      req.companyId = company._id;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
