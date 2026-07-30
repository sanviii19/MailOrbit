import { Router } from 'express';
import * as senderController from '../controllers/sender.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// All sender routes require authentication
router.use(authenticate);

router.get('/', senderController.listSenders);
router.post('/', senderController.createSender);
router.delete('/:id', senderController.deleteSender);

export default router;
