import { describe, expect, it } from 'vitest';
import {
  APPROVER_ROLES,
  LABEL_ROLE_PERMISSIONS,
  ORG_ROLE_PERMISSIONS,
  labelRole,
  orgRole,
  permission,
} from '../src/access.js';

describe('access matrix', () => {
  it('defines permissions for every declared role', () => {
    for (const role of labelRole.options) {
      expect(LABEL_ROLE_PERMISSIONS[role].size).toBeGreaterThan(0);
    }
    for (const role of orgRole.options) {
      expect(ORG_ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it('grants only permissions that exist in the permission enum', () => {
    const known = new Set(permission.options);
    for (const role of labelRole.options) {
      for (const granted of LABEL_ROLE_PERMISSIONS[role]) {
        expect(known.has(granted)).toBe(true);
      }
    }
  });

  it('keeps a viewer read-only', () => {
    const viewer = LABEL_ROLE_PERMISSIONS.label_viewer;
    for (const granted of viewer) {
      expect(granted.endsWith(':read')).toBe(true);
    }
  });

  it('does not let an editor approve anything', () => {
    const editor = LABEL_ROLE_PERMISSIONS.label_editor;
    expect(editor.has('content:approve')).toBe(false);
    expect(editor.has('brief:approve')).toBe(false);
    expect(editor.has('persona:approve')).toBe(false);
    expect(editor.has('brand:approve')).toBe(false);
  });

  it('separates draft export from publish-ready export', () => {
    // An editor may produce a clearly-labelled draft but must not be able to
    // assert that a package is ready to publish.
    expect(LABEL_ROLE_PERMISSIONS.label_editor.has('export:create_draft')).toBe(true);
    expect(LABEL_ROLE_PERMISSIONS.label_editor.has('export:create_publish_ready')).toBe(false);
    expect(LABEL_ROLE_PERMISSIONS.label_approver.has('export:create_publish_ready')).toBe(true);
  });

  it('gives no organisation role access to label content', () => {
    // The central tenant-isolation property: org administration must not imply
    // the ability to read another label's campaigns, briefs or content.
    const forbiddenForOrgRoles = [
      'content:read',
      'brief:read',
      'campaign:read',
      'persona:read',
      'export:read',
    ] as const;
    for (const role of orgRole.options) {
      for (const denied of forbiddenForOrgRoles) {
        expect(ORG_ROLE_PERMISSIONS[role].has(denied)).toBe(false);
      }
    }
  });

  it('lists only roles that actually hold content:approve as approver roles', () => {
    for (const role of APPROVER_ROLES) {
      expect(LABEL_ROLE_PERMISSIONS[role].has('content:approve')).toBe(true);
    }
  });
});
