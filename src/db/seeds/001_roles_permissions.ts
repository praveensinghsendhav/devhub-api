import type { Knex } from 'knex';
import argon2 from 'argon2';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '../../shared/index.js';

export async function seed(knex: Knex): Promise<void> {
  await knex('permissions')
    .insert(PERMISSIONS.map((key) => ({ key })))
    .onConflict('key')
    .ignore();

  await knex('roles')
    .insert(ROLES.map((name) => ({ name })))
    .onConflict('name')
    .ignore();

  const roleRows = await knex('roles').select<{ id: string; name: string }[]>('id', 'name');
  const permissionRows = await knex('permissions').select<{ id: string; key: string }[]>(
    'id',
    'key',
  );
  const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));
  const permissionIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

  const rolePermissionRows = ROLES.flatMap((roleName) =>
    ROLE_PERMISSIONS[roleName].map((permissionKey) => ({
      role_id: roleIdByName.get(roleName),
      permission_id: permissionIdByKey.get(permissionKey),
    })),
  );

  await knex('role_permissions')
    .insert(rolePermissionRows)
    .onConflict(['role_id', 'permission_id'])
    .ignore();

  const adminEmail = 'admin@devhub.local';
  const existingAdmin = await knex('users').where({ email: adminEmail }).first();

  if (!existingAdmin) {
    const passwordHash = await argon2.hash('ChangeMe123!');
    const [admin] = await knex('users')
      .insert({ email: adminEmail, name: 'DevHub Admin', password_hash: passwordHash })
      .returning('id');

    await knex('user_roles').insert({
      user_id: admin.id,
      role_id: roleIdByName.get('SUPER_ADMIN'),
    });

    await knex('user_status').insert({ user_id: admin.id, status: 'offline' });
  }
}
