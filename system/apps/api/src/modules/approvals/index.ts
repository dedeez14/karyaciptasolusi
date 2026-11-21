import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';

/** Controllers and providers of the approvals module (registered in app.module.ts). */
export const APPROVALS_CONTROLLERS: any[] = [ApprovalController];
export const APPROVALS_PROVIDERS: any[] = [ApprovalService];
