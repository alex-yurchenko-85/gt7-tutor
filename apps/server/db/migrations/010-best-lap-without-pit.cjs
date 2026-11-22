async function setBestLap(knex, lapFilter) {
  await knex.raw(`
    update races set best_lap = chosen.number, best_lap_ms = chosen.time_ms
    from (
      select distinct on (race_id) race_id, number, time_ms
      from race_laps
      ${lapFilter}
      order by race_id, time_ms, number
    ) as chosen
    where races.id = chosen.race_id
  `);
}

exports.up = async function up(knex) {
  await setBestLap(knex, '');
  await setBestLap(knex, 'where not pit_in and not pit_out');
};

exports.down = async function down(knex) {
  await setBestLap(knex, '');
};
