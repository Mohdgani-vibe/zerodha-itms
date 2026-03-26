import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // In a real app we would check password hashes. 
    // Here we're checking if user exists or we auto-route for demo purposes.
    let user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      // Auto seed for demo logic
      const isSuperAdmin = email.toLowerCase().includes('admin') || email.toLowerCase().includes('super');
      const isItTeam = email.toLowerCase().includes('it');
      const roleName = isSuperAdmin ? 'Super Admin' : (isItTeam ? 'IT Team' : 'Employee');

      let role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        role = await prisma.role.create({ data: { name: roleName } });
      }

      user = await prisma.user.create({
        data: {
          email,
          fullName: email.split('@')[0],
          employeeCode: `EMP${Math.floor(Math.random() * 10000)}`,
          passwordHash: 'dummy_hash', // We ignore password auth for Phase 1 demo
          roleId: role.id
        },
        include: { role: true }
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role.name },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Determine default portal path
    let defaultPortal = '/portal/employee';
    if (user.role.name === 'Super Admin') defaultPortal = '/portal/superadmin';
    if (user.role.name === 'IT Team') defaultPortal = '/portal/itteam';

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role.name,
        defaultPortal
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

export default router;
