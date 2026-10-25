import mongoose from "mongoose";

const designationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    normalizedName: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    active: { type: Boolean, default: true, required: true }
  },
  { timestamps: true }
);

designationSchema.index(
  { companyId: 1, departmentId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

const Designation = mongoose.models.Designation ||
  mongoose.model("Designation", designationSchema);

export default Designation;
