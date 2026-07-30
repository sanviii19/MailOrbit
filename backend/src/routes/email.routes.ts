import { Router } from 'express';
import * as emailController from '../controllers/email.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// All email routes require authentication
router.use(authenticate);

// Dashboard feeds
router.get('/stats', emailController.getStats);
router.get('/scheduled', emailController.listScheduled);
router.get('/sent', emailController.listSent);

// Single email operations
router.get('/:id', emailController.getEmail);
router.patch('/:id/star', emailController.toggleStar);
router.delete('/:id', emailController.cancelOrDelete);

export default router;
