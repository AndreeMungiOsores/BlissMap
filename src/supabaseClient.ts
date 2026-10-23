import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || 'https://yqgnssxyimiigoewiidr.supabase.co';
const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || 'sb_publishable_73gsrj8xqG2iEXJODQys2w_F0CSBJDo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
