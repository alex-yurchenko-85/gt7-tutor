const PLACED_KINDS = ['brake', 'ease-off', 'throttle', 'big-stop', 'keep-left', 'keep-right'];

exports.up = async function up(knex) {
  await knex.schema.alterTable('cue_events', table => {
    table.text('event_kind');
    table.double('s_m');
  });
  await knex.raw(
    `update cue_events set
      event_kind = case
        when event_key = 'focus' then 'focus'
        when event_key like 'countdown-%' then 'countdown'
        when event_key like 'guidance-%' then 'guidance'
        when position('@' in event_key) > 1 then split_part(event_key, '@', 1)
        else kind
      end,
      s_m = case
        when position('@' in event_key) > 1 and split_part(event_key, '@', 1) = any(?) then split_part(event_key, '@', 2)::double precision
        else null
      end`,
    [PLACED_KINDS]
  );
  await knex.schema.alterTable('cue_events', table => {
    table.dropNullable('event_kind');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('cue_events', table => {
    table.dropColumn('s_m');
    table.dropColumn('event_kind');
  });
};
