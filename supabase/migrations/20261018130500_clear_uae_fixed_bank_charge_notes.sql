-- Remove the fixed "add 72 USD/EUR" SHA instruction from the UAE presets.
-- Bank charges are optional and are entered on each PI.
-- Issued snapshots in pi_versions and stored PDFs are not modified.
update public.company_presets
set bank_notes = ''
where code = 'AE-USD'
  and bank_notes like '%72 USD%';

update public.company_presets
set bank_notes = ''
where code = 'AE-EUR'
  and bank_notes like '%72 EUR%';
