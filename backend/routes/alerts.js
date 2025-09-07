const express = require('express');
const Alert = require('../models/Alert');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { validateAlertCreation } = require('../middleware/validation');

const router = express.Router();

// @desc    Get all alerts (with optional filtering)
// @route   GET /api/alerts
// @access  Public (with optional user context)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      type,
      severity,
      status = 'active',
      lat,
      lng,
      radius = 50,
      limit = 20,
      page = 1,
      sort = '-createdAt'
    } = req.query;

    // Build filter object
    const filter = { isPublic: true };
    
    if (type) filter.type = type;
    if (severity) filter.severity = severity;
    if (status) filter.status = status;

    // Add date filter for active alerts
    if (status === 'active') {
      const now = new Date();
      filter.validFrom = { $lte: now };
      filter.validUntil = { $gte: now };
    }

    // Build query
    let query = Alert.find(filter)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // If location is provided, find alerts within radius
    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const searchRadius = parseFloat(radius) / 6371; // Convert km to radians

      query = query.where({
        location: {
          $geoWithin: {
            $centerSphere: [[longitude, latitude], searchRadius]
          }
        }
      });
    }

    const alerts = await query.exec();
    const total = await Alert.countDocuments(filter);

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching alerts'
    });
  }
});

// @desc    Get single alert
// @route   GET /api/alerts/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    // Increment view count
    alert.statistics.views += 1;
    await alert.save();

    res.json({
      success: true,
      data: { alert }
    });
  } catch (error) {
    console.error('Get alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching alert'
    });
  }
});

// @desc    Create new alert
// @route   POST /api/alerts
// @access  Private (Admin only)
router.post('/', protect, authorize('admin'), validateAlertCreation, async (req, res) => {
  try {
    const alertData = {
      ...req.body,
      createdBy: req.user._id,
      location: {
        type: 'Point',
        coordinates: req.body.location.coordinates,
        address: req.body.location.address,
        city: req.body.location.city,
        state: req.body.location.state,
        country: req.body.location.country,
        radius: req.body.location.radius || 50
      }
    };

    const alert = await Alert.create(alertData);
    await alert.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      data: { alert }
    });
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating alert'
    });
  }
});

// @desc    Update alert
// @route   PUT /api/alerts/:id
// @access  Private (Admin only)
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    // Update alert data
    const updateData = {
      ...req.body,
      updatedBy: req.user._id
    };

    // Handle location update
    if (req.body.location) {
      updateData.location = {
        type: 'Point',
        coordinates: req.body.location.coordinates,
        address: req.body.location.address,
        city: req.body.location.city,
        state: req.body.location.state,
        country: req.body.location.country,
        radius: req.body.location.radius || alert.location.radius
      };
    }

    const updatedAlert = await Alert.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email')
     .populate('updatedBy', 'name email');

    res.json({
      success: true,
      message: 'Alert updated successfully',
      data: { alert: updatedAlert }
    });
  } catch (error) {
    console.error('Update alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating alert'
    });
  }
});

// @desc    Delete alert
// @route   DELETE /api/alerts/:id
// @access  Private (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    await Alert.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Alert deleted successfully'
    });
  } catch (error) {
    console.error('Delete alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting alert'
    });
  }
});

// @desc    Get alerts by location
// @route   GET /api/alerts/location/:lat/:lng
// @access  Public
router.get('/location/:lat/:lng', optionalAuth, async (req, res) => {
  try {
    const { lat, lng } = req.params;
    const { radius = 50, type, severity } = req.query;

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const searchRadius = parseFloat(radius) / 6371; // Convert km to radians

    const filter = {
      isPublic: true,
      status: 'active',
      location: {
        $geoWithin: {
          $centerSphere: [[longitude, latitude], searchRadius]
        }
      },
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() }
    };

    if (type) filter.type = type;
    if (severity) filter.severity = severity;

    const alerts = await Alert.find(filter)
      .populate('createdBy', 'name email')
      .sort({ severity: -1, createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      data: { alerts }
    });
  } catch (error) {
    console.error('Get alerts by location error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching location alerts'
    });
  }
});

// @desc    Get alert statistics
// @route   GET /api/alerts/stats/overview
// @access  Private (Admin only)
router.get('/stats/overview', protect, authorize('admin'), async (req, res) => {
  try {
    const now = new Date();
    
    const stats = await Alert.aggregate([
      {
        $facet: {
          totalAlerts: [
            { $count: 'count' }
          ],
          activeAlerts: [
            {
              $match: {
                status: 'active',
                validFrom: { $lte: now },
                validUntil: { $gte: now }
              }
            },
            { $count: 'count' }
          ],
          alertsByType: [
            {
              $group: {
                _id: '$type',
                count: { $sum: 1 }
              }
            }
          ],
          alertsBySeverity: [
            {
              $group: {
                _id: '$severity',
                count: { $sum: 1 }
              }
            }
          ],
          recentAlerts: [
            {
              $match: {
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ]);

    res.json({
      success: true,
      data: { stats: stats[0] }
    });
  } catch (error) {
    console.error('Get alert stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching alert statistics'
    });
  }
});

module.exports = router;
