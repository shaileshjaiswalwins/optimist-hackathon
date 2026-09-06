use spacetimedb::{reducer, table, ReducerContext, Table, Timestamp};

/// One dead project. `public` = every connected client can read it live.
#[table(accessor = tombstone, public)]
pub struct Tombstone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,      // the project's name
    pub cause: String,     // cause of death ("ran out of motivation")
    pub epitaph: String,   // a few last words
    pub buried_by: String, // who buried it
    pub created_at: Timestamp,
}

/// Bury a project. Every client subscribed to `tombstone` sees the new row instantly.
#[reducer]
pub fn bury(
    ctx: &ReducerContext,
    name: String,
    cause: String,
    epitaph: String,
    buried_by: String,
) -> Result<(), String> {
    fn clip(s: String, n: usize) -> String {
        s.trim().chars().take(n).collect()
    }
    let name = clip(name, 60);
    if name.is_empty() {
        return Err("A project needs a name before it can be buried.".to_string());
    }
    ctx.db.tombstone().insert(Tombstone {
        id: 0, // auto_inc fills this in
        name,
        cause: clip(cause, 80),
        epitaph: clip(epitaph, 160),
        buried_by: clip(buried_by, 40),
        created_at: ctx.timestamp,
    });
    Ok(())
}
