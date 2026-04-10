"""
Query Google Drive for file inventory — shared documents and access.
Returns JSON to stdout for the Express API route.
"""
from google.oauth2 import service_account
from googleapiclient.discovery import build
import json
import sys

KEY_PATH = r'C:\Users\Manzano\.config\gcloud\mpower-ops-service-account.json'
SENDER = 'tom@mpoweranalytics.com'

creds = service_account.Credentials.from_service_account_file(
    KEY_PATH,
    scopes=['https://www.googleapis.com/auth/drive'],
    subject=SENDER
)
service = build('drive', 'v3', credentials=creds)

results = service.files().list(
    pageSize=100,
    fields='files(id,name,mimeType,modifiedTime,shared,permissions,webViewLink)',
    orderBy='modifiedTime desc'
).execute()

files = results.get('files', [])
output = []
for f in files:
    shared_with = []
    for p in f.get('permissions', []):
        email = p.get('emailAddress', '')
        if email and email != SENDER:
            shared_with.append(email)

    mime = f.get('mimeType', '')
    file_type = mime.split('.')[-1] if '.' in mime else mime.split('/')[-1]

    output.append({
        'name': f['name'],
        'type': file_type,
        'modified': f.get('modifiedTime', '')[:10],
        'shared_with': shared_with,
        'link': f.get('webViewLink', ''),
        'id': f['id']
    })

print(json.dumps(output))
