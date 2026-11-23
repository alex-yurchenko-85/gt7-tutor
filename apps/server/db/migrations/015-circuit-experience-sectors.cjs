const RENAMES = [
  { from: 'ce-tsukuba-circuit', fromName: 'Tsukuba Circuit', to: 'ce-tsukuba-circuit-s1', toName: 'Tsukuba Circuit · Sector 1' },
  { from: 'ce-autodromo-de-interlagos', fromName: 'Autódromo de Interlagos', to: 'ce-autodromo-de-interlagos-s2', toName: 'Autódromo de Interlagos · Sector 2' }
];

exports.up = async function up(knex) {
  for (const rename of RENAMES) {
    await knex('exercises').where({ catalogue_id: rename.from }).update({ catalogue_id: rename.to, name: rename.toName });
  }
};

exports.down = async function down(knex) {
  for (const rename of RENAMES) {
    await knex('exercises').where({ catalogue_id: rename.to }).update({ catalogue_id: rename.from, name: rename.fromName });
  }
};
