const mongoose = require('mongoose');

const reportDetailSchema = new mongoose.Schema({
    platform_name: { type: String, required: true },
    initial_fichas: { type: Number, default: 0 },
    total_charges: { type: Number, default: 0 },
    total_withdrawals: { type: Number, default: 0 },
    panel_balance: { type: Number, default: 0 }
}, { _id: false });

const shiftReportSchema = new mongoose.Schema({
    report_date: { type: Date, required: true },
    created_at: { type: Date, default: Date.now },
    details: [reportDetailSchema]
});

shiftReportSchema.index({ report_date: -1 });

module.exports = mongoose.model('ShiftReport', shiftReportSchema);
