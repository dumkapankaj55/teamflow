function success(res, data, status = 200, message) {
  return res.status(status).json({ success: true, ...(message ? { message } : {}), data });
}

module.exports = { success };
