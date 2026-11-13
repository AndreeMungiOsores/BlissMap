-- Espejo de solo lectura de Dataverse en Supabase (lo llena scripts/dataverse/sync-mirror.mjs cada hora).
-- Ejecutar UNA vez en Supabase > SQL Editor. Solo crea tablas nuevas con prefijo dv_; no toca las bm_*.
-- RLS activada y sin políticas: solo la clave secreta (service role) puede leer/escribir; la web pública no ve nada.

create table if not exists dv_mirror_contactos (
  id uuid primary key,
  codigo text,
  nombre text,
  nombre_comercial text,
  documento text,
  ruc text,
  ruc10 text,
  cmp text,
  ge_id uuid,
  estado int,
  tiene_logo boolean default false,
  modificado timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists dv_mirror_grupos (
  id uuid primary key,
  codigo text,
  nombre text,
  propietario text,
  propietario_contacto_id uuid,
  rol text,
  estado int,
  modificado timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists dv_mirror_direcciones (
  id uuid primary key,
  codigo text,
  contacto_id uuid,
  sede text,
  direccion text,
  latitud text,
  longitud text,
  estado int,
  modificado timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists dv_sync_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  contactos int,
  grupos int,
  direcciones int,
  fichas_vinculadas int,
  drift jsonb
);

create index if not exists dv_mirror_contactos_documento_idx on dv_mirror_contactos (documento);
create index if not exists dv_mirror_contactos_cmp_idx on dv_mirror_contactos (cmp);
create index if not exists dv_mirror_contactos_ge_idx on dv_mirror_contactos (ge_id);

alter table dv_mirror_contactos   enable row level security;
alter table dv_mirror_grupos      enable row level security;
alter table dv_mirror_direcciones enable row level security;
alter table dv_sync_log           enable row level security;

-- Columna agregada despues para bases ya creadas (idempotente)
alter table dv_mirror_grupos add column if not exists rol text;

-- El panel de administracion (usuarios con sesion iniciada) puede LEER el catalogo de grupos economicos;
-- la web publica (llave anonima) no ve nada. Las demas tablas siguen sin acceso desde el navegador.
drop policy if exists dv_mirror_grupos_lectura_panel on dv_mirror_grupos;
create policy dv_mirror_grupos_lectura_panel on dv_mirror_grupos for select to authenticated using (true);
