import pandas as pd
import unicodedata
import requests
import json
import time
import os

def clean_str(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize('NFKD', s)
    s = "".join([c for c in s if not unicodedata.combining(c)])
    s = "".join([c if c.isalnum() or c.isspace() else " " for c in s])
    return " ".join(s.upper().split())

# 1. Load CSVs
df_sales = pd.read_csv(r'C:\Users\Andree\Downloads\DataPlazaDerma\Reporte Doc Anka_Limpio.csv', encoding='utf-8')
df_clients = pd.read_csv(r'C:\Users\Andree\Downloads\DataPlazaDerma\ReporteClientes.csv', encoding='utf-8')

df_sales['clean_doc'] = df_sales['name'].apply(clean_str)

# 2. Build Client Map
client_records = []
for idx, row in df_clients.iterrows():
    nc = clean_str(row['NOMBRE COMERCIAL'])
    rs = clean_str(row['RAZON SOCIAL'])
    ap_nom = clean_str(f"{row['APELLIDOS']} {row['NOMBRES']}")
    nom_ap = clean_str(f"{row['NOMBRES']} {row['APELLIDOS']}")
    addr = str(row['DIRECCION']).strip() if pd.notna(row['DIRECCION']) else ""
    
    variants = set(filter(None, [nc, rs, ap_nom, nom_ap]))
    client_records.append({
        'index': idx,
        'variants': variants,
        'address': addr,
        'nombre_comercial': str(row['NOMBRE COMERCIAL']).strip() if pd.notna(row['NOMBRE COMERCIAL']) else "",
        'razon_social': str(row['RAZON SOCIAL']).strip() if pd.notna(row['RAZON SOCIAL']) else "",
        'doc_type': str(row['TIPO DOCUMENTO']).strip() if pd.notna(row['TIPO DOCUMENTO']) else "",
        'doc_num': str(row['DOCUMENTO']).strip() if pd.notna(row['DOCUMENTO']) else ""
    })

sales_docs = df_sales['clean_doc'].unique()

# 3. Match Doctors between Sales and Clients
matched_doctors = {}
for doc in sales_docs:
    matched_client = None
    for c in client_records:
        if doc in c['variants']:
            matched_client = c
            break
        doc_words = set(doc.split())
        if len(doc_words) >= 2:
            for var in c['variants']:
                if doc_words == set(var.split()):
                    matched_client = c
                    break
            if matched_client:
                break
                
    if matched_client:
        matched_doctors[doc] = matched_client

print(f"Matched Doctors Count: {len(matched_doctors)}")

# 4. Geocode addresses locally using Esri World Geocoder
def geocode_esri(address_text):
    if not address_text or len(address_text) < 3:
        return None, None, address_text
    query_addr = address_text
    if 'peru' not in query_addr.lower() and 'perú' not in query_addr.lower():
        query_addr += ", Perú"
        
    url = f"https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine={requests.utils.quote(query_addr)}&maxLocations=1"
    try:
        r = requests.get(url, timeout=5)
        data = r.json()
        if data.get('candidates'):
            cand = data['candidates'][0]
            return cand['location']['y'], cand['location']['x'], cand['address']
    except Exception as e:
        print("Geocode error:", e)
    return None, None, address_text

doctors_list = []
doc_id_counter = 1

for doc_clean, client_data in matched_doctors.items():
    # Filter sales for this doctor
    doc_sales = df_sales[df_sales['clean_doc'] == doc_clean]
    
    # Aggregate products
    products_map = {}
    for _, sale_row in doc_sales.iterrows():
        pname = str(sale_row['name.1']).strip()
        qty = int(sale_row['QTY']) if pd.notna(sale_row['QTY']) else 1
        pdate = str(sale_row['create_date']).strip() if pd.notna(sale_row['create_date']) else ""
        
        if pname in products_map:
            products_map[pname]['qty'] += qty
            if pdate > products_map[pname]['last_date']:
                products_map[pname]['last_date'] = pdate
        else:
            products_map[pname] = {
                'name': pname,
                'qty': qty,
                'last_date': pdate
            }
            
    products_list = list(products_map.values())
    
    # Display name
    display_name = client_data['nombre_comercial'] or client_data['razon_social'] or doc_clean
    addr = client_data['address']
    
    # Geocode address
    lat, lng, formatted_addr = geocode_esri(addr)
    
    if not lat or not lng:
        # Default fallback to Peru center if geocode unresolvable
        lat, lng = -12.046374, -77.042793
        
    # Extract tags (e.g. city/district from address)
    addr_parts = [p.strip() for p in addr.split(',') if p.strip()]
    tags = ["medico"]
    if len(addr_parts) >= 2:
        tags.append(addr_parts[-1].lower())
    if len(addr_parts) >= 3:
        tags.append(addr_parts[-2].lower())
        
    doc_item = {
        "id": f"doc-{doc_id_counter}",
        "name": display_name,
        "address": addr,
        "lat": lat,
        "lng": lng,
        "phone": None,
        "email": None,
        "website": None,
        "description": f"Médico especialista. Razón Social: {client_data['razon_social']}",
        "tags": list(set(tags)),
        "custom_fields": {
            "Documento": f"{client_data['doc_type']} {client_data['doc_num']}".strip(),
            "Razón Social": client_data['razon_social']
        },
        "published": True,
        "image_url": None,
        "products": products_list
    }
    
    doctors_list.append(doc_item)
    print(f"[{doc_id_counter}/411] Processed: {display_name[:30]} | Products: {len(products_list)} | Coords: ({lat:.4f}, {lng:.4f})")
    doc_id_counter += 1
    time.sleep(0.05)

# Save to src/data/doctors_data.json
out_dir = r"c:\Users\Andree\Desktop\Bliss Project\PROYECTOS SOFTWARE\BlissMap\src\data"
os.makedirs(out_dir, exist_ok=True)
out_file = os.path.join(out_dir, "doctors_data.json")

with open(out_file, "w", encoding="utf-8") as f:
    json.dump(doctors_list, f, ensure_ascii=False, indent=2)

print(f"\nSuccessfully generated local dataset with {len(doctors_list)} doctors in '{out_file}'!")
