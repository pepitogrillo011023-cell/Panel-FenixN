const mongoose = require('mongoose');
const RetiroSolicitud = require('../models/RetiroSolicitud');
const Transaction = require('../models/Transaction');
const ShiftReport = require('../models/ShiftReport');

const PLATFORMS = ['Oropuro', 'Ganamos', 'Créditos'];
const NEW_USER_HOURS = parseInt(process.env.NEW_USER_HOURS || '24', 10);

function normalizePlatform(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (n.includes('oro')) return 'Oropuro';
    if (n.includes('ganamos')) return 'Ganamos';
    if (n.includes('créd') || n.includes('cred')) return 'Créditos';
    return null;
}

function createEmptyStats() {
    return PLATFORMS.reduce((acc, platform) => {
        acc[platform] = {
            platform_name: platform,
            total_charges: 0,
            total_withdrawals: 0,
            panel_balance: 0
        };
        return acc;
    }, {});
}

function parseDateRange(start, end) {
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error('Fechas inválidas. Use formato YYYY-MM-DD.');
    }

    if (startDate > endDate) {
        throw new Error('La fecha de inicio no puede ser posterior a la fecha de fin.');
    }

    return { startDate, endDate };
}

async function buildLiveStats(startDate, endDate) {
    const Carga = mongoose.model('Carga');
    const stats = createEmptyStats();

    const cargas = await Carga.find({
        estado: 'aprobado',
        fecha: { $gte: startDate, $lte: endDate }
    }).lean();

    cargas.forEach((carga) => {
        const platform = normalizePlatform(carga.plataforma);
        if (platform && stats[platform]) {
            stats[platform].total_charges += Number(carga.monto) || 0;
        }
    });

    const creditCharges = await Transaction.find({
        type: 'credit_charge',
        status: 'approved',
        createdAt: { $gte: startDate, $lte: endDate }
    }).lean();

    creditCharges.forEach((tx) => {
        stats['Créditos'].total_charges += Number(tx.amount) || 0;
    });

    const retiros = await RetiroSolicitud.find({
        estado: 'aprobado',
        fechaCreacion: { $gte: startDate, $lte: endDate }
    }).lean();

    retiros.forEach((retiro) => {
        const platform = normalizePlatform(retiro.plataforma) || 'Créditos';
        if (stats[platform]) {
            stats[platform].total_withdrawals += Number(retiro.monto) || 0;
        }
    });

    PLATFORMS.forEach((platform) => {
        stats[platform].panel_balance =
            stats[platform].total_charges - stats[platform].total_withdrawals;
    });

    return Object.values(stats);
}

async function countNewUsers(hours = NEW_USER_HOURS) {
    const Cliente = mongoose.model('Cliente');
    const desde = new Date(Date.now() - hours * 60 * 60 * 1000);
    return Cliente.countDocuments({ fechaRegistro: { $gte: desde } });
}

module.exports = function (app, requireLogin) {
    app.get('/api/stats/live', requireLogin, async (req, res) => {
        try {
            const { start, end } = req.query;
            if (!start || !end) {
                return res.status(400).json({
                    exito: false,
                    mensaje: 'Parámetros start y end son obligatorios (YYYY-MM-DD).'
                });
            }

            const { startDate, endDate } = parseDateRange(start, end);
            const platforms = await buildLiveStats(startDate, endDate);
            const new_users_24h = await countNewUsers(NEW_USER_HOURS);

            res.json({
                exito: true,
                start,
                end,
                platforms,
                new_users_24h,
                new_user_hours: NEW_USER_HOURS
            });
        } catch (error) {
            res.status(400).json({ exito: false, mensaje: error.message });
        }
    });

    app.post('/api/reports/close', requireLogin, async (req, res) => {
        try {
            const { report_date, details } = req.body;

            if (!report_date || !Array.isArray(details) || details.length === 0) {
                return res.status(400).json({
                    exito: false,
                    mensaje: 'Se requiere report_date y un arreglo details con al menos una plataforma.'
                });
            }

            const parsedReportDate = new Date(report_date);
            if (Number.isNaN(parsedReportDate.getTime())) {
                return res.status(400).json({ exito: false, mensaje: 'report_date inválido.' });
            }

            const normalizedDetails = details.map((item) => {
                const totalCharges = Number(item.total_charges) || 0;
                const totalWithdrawals = Number(item.total_withdrawals) || 0;

                return {
                    platform_name: item.platform_name,
                    initial_fichas: Number(item.initial_fichas) || 0,
                    total_charges: totalCharges,
                    total_withdrawals: totalWithdrawals,
                    panel_balance: totalCharges - totalWithdrawals
                };
            });

            const report = await ShiftReport.create({
                report_date: parsedReportDate,
                details: normalizedDetails
            });

            res.json({
                exito: true,
                mensaje: 'Cierre de caja guardado correctamente.',
                report: {
                    id: report._id,
                    report_date: report.report_date,
                    created_at: report.created_at,
                    details: report.details
                }
            });
        } catch (error) {
            res.status(500).json({ exito: false, mensaje: error.message });
        }
    });

    app.get('/api/reports/history', requireLogin, async (req, res) => {
        try {
            const { start, end } = req.query;
            const filter = {};

            if (start || end) {
                filter.report_date = {};
                if (start) {
                    const { startDate } = parseDateRange(start, end || start);
                    filter.report_date.$gte = startDate;
                }
                if (end) {
                    const { endDate } = parseDateRange(start || end, end);
                    filter.report_date.$lte = endDate;
                }
            }

            const reports = await ShiftReport.find(filter)
                .sort({ report_date: -1, created_at: -1 })
                .lean();

            res.json({
                exito: true,
                reports: reports.map((report) => ({
                    id: report._id,
                    report_date: report.report_date,
                    created_at: report.created_at,
                    details: report.details
                }))
            });
        } catch (error) {
            res.status(400).json({ exito: false, mensaje: error.message });
        }
    });
};
