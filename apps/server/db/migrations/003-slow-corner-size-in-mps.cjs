const KPH_PER_MPS = 3.6;

exports.up = async function up(knex) {
  await knex.raw('alter table attempt_findings drop constraint attempt_findings_unit_check');
  await knex('attempt_findings')
    .where({ kind: 'slow-corner', unit: 'km/h' })
    .update({ size: knex.raw('size / ?', [KPH_PER_MPS]), unit: 'm/s' });
  await knex.raw("alter table attempt_findings add constraint attempt_findings_unit_check check (unit in ('m', 'm/s'))");
};

exports.down = async function down(knex) {
  await knex.raw('alter table attempt_findings drop constraint attempt_findings_unit_check');
  await knex('attempt_findings')
    .where({ kind: 'slow-corner', unit: 'm/s' })
    .update({ size: knex.raw('size * ?', [KPH_PER_MPS]), unit: 'km/h' });
  await knex.raw("alter table attempt_findings add constraint attempt_findings_unit_check check (unit in ('m', 'km/h'))");
};
