import mongoose from "mongoose";

const companyHolidaySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    normalizedName: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    recurringAnnually: { type: Boolean, default: false, required: true },
    active: { type: Boolean, default: true, required: true }
  },
  { timestamps: true }
);

companyHolidaySchema.index(
  { companyId: 1, date: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

const CompanyHoliday = mongoose.models.CompanyHoliday ||
  mongoose.model("CompanyHoliday", companyHolidaySchema);

export default CompanyHoliday;
