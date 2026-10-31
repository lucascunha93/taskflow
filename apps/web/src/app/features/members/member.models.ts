import { OrganizationRole } from '../organizations/organization.models';

export type AddMemberRole = 'ADMIN' | 'MEMBER';

export interface Member {
  id: string;
  role: OrganizationRole;
  createdAt: string;
  user: { id: string; name: string; email: string };
}
