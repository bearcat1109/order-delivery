// Server js for order delivery service. Gabriel Berres
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// MongoDB Connect
mongoose.connect('mongodb://127.0.0.1:27017/deliverySystem', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).catch(err => console.error('MongoDB connection error:', err));


// Schemas
// Businesses
const businessSchema = new mongoose.Schema({
  businessName: String,
  businessStreet: String,
  businessCity: String,
  businessState: String,
  businessZipCode: String,
  businessContact: String,
  businessEmail: String,
  businessPhone: String
});

// Drivers
const driverSchema = new mongoose.Schema({
  driverName: String,
  contactInfo: String,
  availabilityStatus: { type: String, default: 'available' }
});

// Zips
const zipCodeSchema = new mongoose.Schema({
  zipCode: String,
  minDeliveryTime: Number,
  maxDeliveryTime: Number,
  expectedDeliveryTime: Number
});

// Orders
const orderSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
  customerStreet: String,
  customerCity: String,
  customerState: String,
  customerZipCode: String,
  orderItems: String,
  orderStatus: { type: String, default: 'received' },
  assignedDriverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
  minDeliveryTime: Date,
  maxDeliveryTime: Date,
  expectedDeliveryTime: Date,
  actualDeliveryTime: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Business = mongoose.model('Business', businessSchema);
const Driver = mongoose.model('Driver', driverSchema);
const ZipCode = mongoose.model('ZipCode', zipCodeSchema);
const Order = mongoose.model('Order', orderSchema);

// Business Routes
app.post('/api/businesses', async (req, res) => {
  try {
    const business = new Business(req.body);
    await business.save();
    res.status(201).json(business);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/businesses', async (req, res) => {
  try {
    const businesses = await Business.find();
    res.json(businesses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Driver Routes
app.post('/api/drivers', async (req, res) => {
  try {
    const driver = new Driver(req.body);
    await driver.save();
    res.status(201).json(driver);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/drivers', async (req, res) => {
  try {
    const drivers = await Driver.find();
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Zip Code Routes
app.post('/api/zipcodes', async (req, res) => {
  try {
    const zipCode = new ZipCode(req.body);
    await zipCode.save();
    res.status(201).json(zipCode);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/zipcodes/:zipCode', async (req, res) => {
  try {
    const zipCode = await ZipCode.findOne({ zipCode: req.params.zipCode });
    res.json(zipCode);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Order Routes
app.post('/api/orders', async (req, res) => {
  try {
    const zipCodeData = await ZipCode.findOne({ zipCode: req.body.customerZipCode });
    if (!zipCodeData) {
      return res.status(400).json({ error: 'Zip code not serviced' });
    }

    const now = new Date();
    const order = new Order({
      ...req.body,
      minDeliveryTime: new Date(now.getTime() + zipCodeData.minDeliveryTime * 60000),
      maxDeliveryTime: new Date(now.getTime() + zipCodeData.maxDeliveryTime * 60000),
      expectedDeliveryTime: new Date(now.getTime() + zipCodeData.expectedDeliveryTime * 60000)
    });
    await order.save();
    
    const business = await Business.findById(order.businessId);
    if (business?.businessEmail) {
      await sendNotification(business.businessEmail, 'Order Created', `Order ${order._id} created`);
    }
    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const filter = {};
    if (req.query.businessId) filter.businessId = req.query.businessId;
    if (req.query.driverId) filter.assignedDriverId = req.query.driverId;
    
    const orders = await Order.find(filter).populate('businessId').populate('assignedDriverId');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('businessId').populate('assignedDriverId');
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (order.orderStatus === 'picked_up' || order.orderStatus === 'out_for_delivery') {
      return res.status(400).json({ error: 'Cannot update after pickup' });
    }
    Object.assign(order, req.body, { updatedAt: new Date() });
    await order.save();
    res.json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (order.assignedDriverId) {
      return res.status(400).json({ error: 'Cannot cancel assigned order' });
    }
    order.orderStatus = 'cancelled';
    await order.save();
    res.json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/orders/:id/assign', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    let driver;
    
    if (req.body.autoAssign) {
      driver = await Driver.findOne({ availabilityStatus: 'available' });
    } else {
      driver = await Driver.findById(req.body.driverId);
    }
    
    if (!driver) return res.status(400).json({ error: 'No driver available' });
    
    order.assignedDriverId = driver._id;
    order.orderStatus = 'assigned';
    await order.save();
    
    driver.availabilityStatus = 'busy';
    await driver.save();
    res.json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    order.orderStatus = req.body.status;
    
    if (req.body.status === 'delivered') {
      order.actualDeliveryTime = new Date();
      if (order.assignedDriverId) {
        await Driver.findByIdAndUpdate(order.assignedDriverId, { availabilityStatus: 'available' });
      }
    }
    await order.save();
    res.json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(3000, () => console.log('Server is running on port 3000'));