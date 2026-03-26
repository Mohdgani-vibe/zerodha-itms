import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get patch dashboard metrics
router.get('/dashboard', async (req, res) => {
  try {
    const totalDevices = await prisma.device.count();
    const upToDate = await prisma.device.count({ where: { patchStatus: 'up_to_date' } });
    const pendingUpdates = await prisma.device.count({ where: { patchStatus: 'pending' } });
    const failedUpdates = await prisma.device.count({ where: { patchStatus: 'failed' } });
    
    // Auto seed mock compliance if needed
    if (totalDevices > 0 && upToDate === totalDevices && pendingUpdates === 0) {
       // Let's create some dummy pending/failed patches for demo
       const devices = await prisma.device.findMany({ take: 3 });
       for (let i = 0; i < devices.length; i++) {
         const dev = devices[i];
         const status = i === 0 ? 'failed' : (i === 1 ? 'pending' : 'up_to_date');
         await prisma.device.update({ where: { id: dev.id }, data: { patchStatus: status }});
       }
    }

    res.json({
        total: totalDevices,
        upToDate,
        pending: pendingUpdates,
        failed: failedUpdates,
        rebootPending: Math.floor(pendingUpdates / 2) // mock calc
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch patch metrics' });
  }
});

// Get all devices with explicit patch data
router.get('/devices', async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      include: {
        user: true,
        department: true,
        branch: true,
        patchGroup: true
      }
    });

    res.json(devices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch patch devices' });
  }
});

export default router;
