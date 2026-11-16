-- Escritura PlazaDerma -> Dataverse (solo ediciones manuales, con doble confirmación).
-- Solo la Edge Function `dv-write` (con la clave de servicio) lee/escribe estas tablas: RLS activa y sin políticas.

create table if not exists dv_write_allowlist (
  email text primary key,
  nota text,
  created_at timestamptz not null default now()
);
alter table dv_write_allowlist enable row level security;

create table if not exists dv_write_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_email text not null,
  op text not null,
  entidad text not null,          -- contacto | direccion | grupo | logo | afiliacion
  registro_id text,               -- GUID del registro en Dataverse
  registro_codigo text,           -- CTO-… / DIR-… / DPS-…
  antes jsonb,
  despues jsonb,
  ok boolean not null,
  error text
);
alter table dv_write_log enable row level security;
create index if not exists dv_write_log_at_idx on dv_write_log (at desc);

-- Cuentas autorizadas a escribir en Dataverse (agregar/quitar con SQL).
insert into dv_write_allowlist (email, nota) values ('ti@blisscorp.lat', 'cuenta administradora inicial')
on conflict (email) do nothing;
