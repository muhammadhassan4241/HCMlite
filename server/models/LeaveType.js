import mongoose from "mongoose";

const leaveTypeSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    normalizedName: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    annualQuota: { type: Number, required: true, min: 0, default: 0 },
    paid: { type: Boolean, required: true, default: true },
    active: { type: Boolean, default: true, required: true }
  },
  { timestamps: true }
);

leaveTypeSchema.index(
  { companyId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

const LeaveType = mongoose.models.LeaveType || mongoose.model("LeaveType", leaveTypeSchema);

export default LeaveType;
