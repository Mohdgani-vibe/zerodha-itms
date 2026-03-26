import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all devices
router.get('/', async (req, res) => {
  try {
    let devices = await prisma.device.findMany({
      include: {
        user: true,
        department: true,
        branch: true,
      }
    });

    // Auto seed for empty db demo
    if (devices.length === 0) {
        const d1 = await prisma.department.findFirst();
        const b1 = await prisma.branch.findFirst();
        if (d1 && b1) {
            await prisma.device.createMany({
                data: [
                    { assetId: 'Z-LAP-2001', hostname: 'ZD-BLR-01', deviceType: 'Laptop', osName: 'macOS', status: 'active', departmentId: d1.id, branchId: b1.id },
                    { assetId: 'Z-LAP-2002', hostname: 'ZD-BLR-02', deviceType: 'Laptop', osName: 'Windows 11', status: 'active', departmentId: d1.id, branchId: b1.id }
                ]
            });
            devices = await prisma.device.findMany({ include: { user: true, department: true, branch: true }});
        }
    }

    res.json(devices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Get single device
router.get('/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        department: true,
        branch: true,
        installedApps: true
      }
    });
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch device' });
  }
});

export default router;
