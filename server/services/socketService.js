const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const User = require('../models/User');
const Membership = require('../models/Membership');

let io;

function userRoom(userId, organizationId) {
  return `user:${userId}:organization:${organizationId}`;
}

function originAllowed(origin) {
  if (!origin) return true;
  const configured = (process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173'))
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (configured.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '5173') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return true;
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
    return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168) || octets[0] === 127;
  } catch (_error) {
    return false;
  }
}

function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin(origin, callback) { callback(null, originAllowed(origin)); }, credentials: true },
    maxHttpBufferSize: 100_000,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const organizationId = socket.handshake.auth?.organizationId;
      if (typeof token !== 'string' || !token || typeof organizationId !== 'string' || !organizationId) {
        return next(new Error('Authentication required'));
      }
      const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, {
        issuer: 'teamflow-api', audience: 'teamflow-client',
      });
      if (!Number.isFinite(payload.exp)) return next(new Error('Invalid socket credentials'));
      const user = await User.findById(payload.sub).select('_id isActive tokenVersion emailVerifiedAt');
      if (!user || !user.isActive || Number(payload.ver || 0) !== Number(user.tokenVersion || 0)) {
        return next(new Error('Session is unavailable'));
      }
      if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerifiedAt) {
        return next(new Error('Email verification required'));
      }
      const membership = await Membership.findOne({ user: user._id, organization: organizationId, status: 'ACTIVE' })
        .populate('organization', 'isActive');
      if (!membership || !membership.organization || !membership.organization.isActive) {
        return next(new Error('Workspace access denied'));
      }
      socket.data.userId = String(user._id);
      socket.data.organizationId = String(organizationId);
      socket.data.role = membership.role;
      socket.data.tokenExpiresAt = payload.exp * 1000;
      return next();
    } catch (_error) {
      return next(new Error('Invalid socket credentials'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.userId, socket.data.organizationId));
    const refreshDelay = Math.max(0, socket.data.tokenExpiresAt - Date.now() - 30_000);
    const refreshTimer = setTimeout(() => socket.emit('session:refresh-required'), refreshDelay);
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.tokenExpiresAt - Date.now()));
    socket.once('disconnect', () => { clearTimeout(refreshTimer); clearTimeout(expiryTimer); });
  });
  return io;
}

function emitNotification(notification) {
  if (!io || !notification?.user || !notification?.organization) return;
  const payload = {
    _id: notification._id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    project: notification.project ? { _id: String(notification.project._id || notification.project) } : null,
    task: notification.task ? { _id: String(notification.task._id || notification.task) } : null,
    isRead: Boolean(notification.isRead),
    createdAt: notification.createdAt,
  };
  io.to(userRoom(String(notification.user), String(notification.organization))).emit('notification:new', payload);
}

function emitActivity({ recipients, organizationId, activity }) {
  if (!io || !Array.isArray(recipients)) return;
  const payload = {
    action: activity.action,
    message: activity.message,
    targetType: activity.targetType,
    targetId: activity.targetId,
    project: activity.project || null,
    task: activity.task || null,
    createdAt: activity.createdAt,
  };
  for (const userId of recipients) {
    io.to(userRoom(String(userId), String(organizationId))).emit('organization:activity', payload);
  }
}

function closeSocket() {
  if (!io) return Promise.resolve();
  const current = io;
  io = null;
  return new Promise((resolve) => current.close(resolve));
}

module.exports = { initializeSocket, emitNotification, emitActivity, closeSocket, userRoom };
