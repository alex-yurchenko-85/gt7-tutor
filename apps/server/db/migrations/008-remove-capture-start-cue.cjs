exports.up = async function up(knex) {
  await knex.schema.alterTable('captures', table => {
    table.dropColumn('start_cue_mono_ms');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('captures', table => {
    table.double('start_cue_mono_ms');
  });
};
