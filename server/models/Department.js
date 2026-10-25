import mongoose from "mongoose";

const departmentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    normalizedName: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    departmentHeadId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    active: { type: Boolean, default: true, required: true }
  },
  { timestamps: true }
);

departmentSchema.index(
  { companyId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

const Department = mongoose.models.Department || mongoose.model("Department", departmentSchema);

export default Department;
