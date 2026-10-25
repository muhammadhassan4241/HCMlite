import mongoose from "mongoose";

const attendanceSnapshotSchema = new mongoose.Schema(
  {
    checkInAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    status: { type: String, enum: ["Present", "Late", "Incomplete"], required: true },
    workingDurationMinutes: { type: Number, min: 0, required: true }
  },
  { _id: false }
);

const correctionSchema = new mongoose.Schema(
  {
    correctedAt: { type: Date, required: true },
    correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    before: { type: attendanceSnapshotSchema, required: true },
    after: { type: attendanceSnapshotSchema, required: true }
  },
  { _id: true }
);

const attendanceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    workDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkInAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    status: { type: String, enum: ["Present", "Late", "Incomplete"], required: true },
    workingDurationMinutes: { type: Number, min: 0, default: 0, required: true },
    correctionHistory: { type: [correctionSchema], default: [] }
  },
  { timestamps: true }
);

attendanceSchema.index(
  { companyId: 1, employeeId: 1, workDate: 1 },
  { unique: true }
);
attendanceSchema.index({ companyId: 1, workDate: 1, status: 1 });
attendanceSchema.index({ companyId: 1, employeeId: 1, workDate: -1 });

const Attendance = mongoose.models.Attendance || mongoose.model("Attendance", attendanceSchema);

export default Attendance;
