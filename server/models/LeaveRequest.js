import mongoose from "mongoose";

const leaveRequestSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    requestedDays: { type: Number, required: true, min: 1, max: 366 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      required: true,
      default: "Pending"
    },
    reviewComment: { type: String, trim: true, maxlength: 1000, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    activeDates: { type: [String], default: [] }
  },
  { timestamps: true }
);

leaveRequestSchema.index(
  { companyId: 1, employeeId: 1, activeDates: 1 },
  { unique: true }
);
leaveRequestSchema.index({ companyId: 1, status: 1, startDate: -1 });
leaveRequestSchema.index({ companyId: 1, employeeId: 1, startDate: -1 });

const LeaveRequest = mongoose.models.LeaveRequest ||
  mongoose.model("LeaveRequest", leaveRequestSchema);

export default LeaveRequest;
