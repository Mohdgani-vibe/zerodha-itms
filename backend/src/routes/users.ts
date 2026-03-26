import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        role: true,
        department: true,
        branch: true,
        _count: {
          select: { devices: true }
        }
      }
    });

    // Auto-seed dummy departments if none exist for Demo 
    if (users.length > 0 && !(await prisma.department.count())) {
        const d1 = await prisma.department.create({ data: { name: 'Support', code: 'SUP' }});
        const d2 = await prisma.department.create({ data: { name: 'Engineering', code: 'ENG' }});
        const b1 = await prisma.branch.create({ data: { name: 'HQ Bangalore', city: 'Bangalore' }});
        
        await prisma.user.updateMany({ data: { departmentId: d1.id, branchId: b1.id } });
    }

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
        branch: true,
        devices: true,
        role: true
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
