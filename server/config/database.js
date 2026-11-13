const mongoose = require('mongoose');
const Invitation = require('../models/Invitation');
const Membership = require('../models/Membership');
const Organization = require('../models/Organization');

async function migrateInvitationExpiryIndex() {
  const collection = Invitation.collection;
  let indexes = [];
  try { indexes = await collection.indexes(); }
  catch (error) { if (error.codeName !== 'NamespaceNotFound') throw error; }
  const ttlIndex = indexes.find((index) => index.expireAfterSeconds !== undefined && index.key?.expiresAt === 1);
  if (ttlIndex) {
    await collection.dropIndex(ttlIndex.name);
    await collection.createIndex({ expiresAt: 1 }, { name: 'expiresAt_1' });
    await collection.createIndex({ organization: 1, status: 1, expiresAt: 1 }, { name: 'organization_1_status_1_expiresAt_1' });

    const now = new Date();
    const [organizations, memberCounts, invitationCounts] = await Promise.all([
      Organization.find().select('_id').lean(),
      Membership.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
      Invitation.aggregate([{ $match: { status: 'PENDING', expiresAt: { $gt: now } } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
    ]);
    const membersByOrganization = new Map(memberCounts.map((row) => [String(row._id), row.count]));
    const invitationsByOrganization = new Map(invitationCounts.map((row) => [String(row._id), row.count]));
    await Promise.all(organizations.map((organization) => Organization.updateOne({ _id: organization._id }, {
      $set: { 'usageCounters.memberSeats': (membersByOrganization.get(String(organization._id)) || 0) + (invitationsByOrganization.get(String(organization._id)) || 0) },
    })));
  }
}

async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is required to start TeamFlow.');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: process.env.NODE_ENV !== 'production' });
  await migrateInvitationExpiryIndex();
  return mongoose.connection;
}

module.exports = connectDatabase;
