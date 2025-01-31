from flask import Flask, render_template, request, jsonify, redirect, url_for, make_response
import json
import os
import jwt
import time
import requests
from datetime import datetime, timedelta
from functools import wraps
from dotenv import load_dotenv
import base64

# Carregar variáveis de ambiente
load_dotenv()

app = Flask(__name__)

# Carregar segredos de variáveis de ambiente
app.secret_key = os.getenv('FLASK_SECRET_KEY')
JWT_SECRET = os.getenv('JWT_SECRET_KEY')

# Configuração do GitHub
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')
GITHUB_REPO = os.getenv('GITHUB_REPO', 'Maarckz/Cris')
GITHUB_BRANCH = os.getenv('GITHUB_BRANCH', 'main')

JWT_EXPIRATION = timedelta(minutes=10)

# Limitação de tentativas de login
MAX_LOGIN_ATTEMPTS = 5
LOGIN_ATTEMPTS = {}

# Database files
USERS_DB = 'data/users.json'
CONTACTS_DB = 'data/contacts.json'
APPOINTMENTS_DB = 'data/appointments.json'

# Ensure data directory exists
os.makedirs('data', exist_ok=True)

# Initialize database files if they don't exist
def init_db():
    if not os.path.exists(USERS_DB):
        with open(USERS_DB, 'w') as f:
            json.dump([], f)  # Senha sem criptografia
    
    if not os.path.exists(CONTACTS_DB):
        with open(CONTACTS_DB, 'w') as f:
            json.dump([], f)
    
    if not os.path.exists(APPOINTMENTS_DB):
        with open(APPOINTMENTS_DB, 'w') as f:
            json.dump([], f)

init_db()

def push_to_github(file_path):
    """ Envia um arquivo para o repositório GitHub via API """
    github_api_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{file_path}"
    
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }

    # Obter a versão atual do arquivo no repositório (se existir)
    response = requests.get(github_api_url, headers=headers)
    file_sha = None  # SHA do arquivo remoto

    if response.status_code == 200:
        file_sha = response.json().get("sha")  # Obter SHA do arquivo atual

    # Ler o conteúdo local do arquivo
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    encoded_content = base64.b64encode(content.encode()).decode()

    # Criar payload do commit
    commit_message = f"Update {file_path} via API"
    data = {
        "message": commit_message,
        "content": encoded_content,
        "branch": GITHUB_BRANCH
    }

    if file_sha:
        data["sha"] = file_sha  # Necessário para modificar arquivos existentes

    # Enviar o commit para o GitHub
    response = requests.put(github_api_url, headers=headers, json=data)

    if response.status_code in [200, 201]:
        print(f"✅ {file_path} enviado com sucesso para o GitHub!")
    else:
        print(f"❌ Erro ao enviar {file_path} para o GitHub:", response.json())

def safe_read_json(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            return json.loads(content) if content else []
    except json.JSONDecodeError:
        return []

def safe_write_json(file_path, data):
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)
    
    # Enviar alterações para o GitHub após escrita
    if file_path in [CONTACTS_DB, APPOINTMENTS_DB]:
        push_to_github(file_path)

def token_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('jwt')
        if not token:
            return redirect(url_for('login'))  # Redireciona se o token não existir
        
        try:
            jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return redirect(url_for('login'))  # Redireciona se o token expirar
        except jwt.InvalidTokenError:
            return redirect(url_for('login'))  # Redireciona se o token for inválido
        
        return f(*args, **kwargs)
    return decorated_function

# Rota de login
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        # Verificar tentativas de login
        if username in LOGIN_ATTEMPTS and LOGIN_ATTEMPTS[username]['attempts'] >= MAX_LOGIN_ATTEMPTS:
            last_attempt = LOGIN_ATTEMPTS[username]['last_attempt']
            if time.time() - last_attempt < 300:  # 5 minutos
                return render_template('login.html', error='Too many login attempts. Try again later.')
            else:
                LOGIN_ATTEMPTS[username] = {'attempts': 0, 'last_attempt': time.time()}
        
        with open(USERS_DB, 'r') as f:
            users = json.load(f)
        
        # Procurar o usuário e verificar a senha
        user = next((u for u in users if u['username'] == username), None)
        
        if user and user['password'] == password:
            token = jwt.encode({'exp': datetime.utcnow() + JWT_EXPIRATION}, JWT_SECRET, algorithm='HS256')
            resp = make_response(redirect(url_for('index')))
            resp.set_cookie('jwt', token, httponly=True, max_age=16000000)
            return resp
        
        # Incrementar as tentativas de login
        if username not in LOGIN_ATTEMPTS:
            LOGIN_ATTEMPTS[username] = {'attempts': 0, 'last_attempt': time.time()}
        
        LOGIN_ATTEMPTS[username]['attempts'] += 1
        LOGIN_ATTEMPTS[username]['last_attempt'] = time.time()

        return render_template('login.html', error='Invalid credentials')
    
    return render_template('login.html')

# Rota de logout
@app.route('/logout')
def logout():
    resp = make_response(redirect(url_for('login')))
    resp.set_cookie('jwt', '', expires=0)
    return resp

# Rota principal
@app.route('/')
@token_required
def index():
    return render_template('index.html')

# API Routes for Contacts
@app.route('/api/contacts', methods=['GET', 'POST'])
@token_required
def contacts():
    if request.method == 'GET':
        contacts = safe_read_json(CONTACTS_DB)
        return jsonify(contacts)
    
    if request.method == 'POST':
        data = request.get_json()
        contacts = safe_read_json(CONTACTS_DB)
        
        contact = {
            'id': str(len(contacts) + 1),
            'name': data['name'],
            'phone': data['phone'],
            'approach': data['approach']
        }
        contacts.append(contact)
        
        safe_write_json(CONTACTS_DB, contacts)
        return jsonify(contact)

@app.route('/api/contacts/<contact_id>', methods=['PUT', 'DELETE'])
@token_required
def contact(contact_id):
    contacts = safe_read_json(CONTACTS_DB)
    appointments = safe_read_json(APPOINTMENTS_DB)
    
    if request.method == 'PUT':
        data = request.get_json()
        for contact in contacts:
            if contact['id'] == contact_id:
                contact.update(data)
                break
    
    elif request.method == 'DELETE':
        # Remove o contato
        contacts = [c for c in contacts if c['id'] != contact_id]
        
        # Remove todos os compromissos associados ao contactId
        appointments = [a for a in appointments if a['contactId'] != contact_id]
        
        # Salva as alterações nos arquivos
        safe_write_json(CONTACTS_DB, contacts)
        safe_write_json(APPOINTMENTS_DB, appointments)
        
        return jsonify({'success': True, 'message': 'Contact and associated appointments deleted successfully'})
    
    safe_write_json(CONTACTS_DB, contacts)
    return jsonify({'success': True})

# API Routes for Appointments
@app.route('/api/appointments', methods=['GET', 'POST'])
@token_required
def appointments():
    if request.method == 'GET':
        appointments = safe_read_json(APPOINTMENTS_DB)
        return jsonify(appointments)

    if request.method == 'POST':
        data = request.get_json()
        appointments = safe_read_json(APPOINTMENTS_DB)
        
        appointment = {
            'id': str(len(appointments) + 1),
            'contactId': data['contactId'],
            'date': data['date'],
            'time': data['time'],
            'isPaid': data.get('isPaid', False),
            'isRecurring': data.get('isRecurring', False)
        }
        appointments.append(appointment)
        
        safe_write_json(APPOINTMENTS_DB, appointments)
        return jsonify(appointment)

@app.route('/api/appointments/<appointment_id>', methods=['PUT', 'DELETE'])
@token_required
def appointment(appointment_id):
    appointments = safe_read_json(APPOINTMENTS_DB)
    
    if request.method == 'PUT':
        data = request.get_json()
        for appointment in appointments:
            if appointment['id'] == appointment_id:
                appointment.update(data)
                break
    
    elif request.method == 'DELETE':
        appointments = [a for a in appointments if a['id'] != appointment_id]
    
    safe_write_json(APPOINTMENTS_DB, appointments)
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
