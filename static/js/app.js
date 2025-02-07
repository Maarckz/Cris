// Estado da aplicação
let contacts = [];
let appointments = [];
let currentWeekStart = new Date();

// Configuração do Flatpickr para seleção de hora
const timePickerConfig = {
    enableTime: true,
    noCalendar: true,
    dateFormat: "H:i",
    time_24hr: true,
    locale: "pt"
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    // Inicializa o seletor de hora
    flatpickr(".time-picker", timePickerConfig);

    // Carrega os dados iniciais
    loadContacts();
    loadAppointments();

    // Configura a semana atual
    setCurrentWeek();
});

// Funções de carregamento de dados
async function loadContacts() {
    try {
        const response = await fetch('/api/contacts');
        contacts = await response.json();
        renderContacts();
        updateContactSelect();
    } catch (error) {
        console.error('Erro ao carregar contatos:', error);
    }
}

async function loadAppointments() {
    try {
        const response = await fetch('/api/appointments');
        appointments = await response.json();
        renderCalendar();
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
    }
}

// Funções de renderização
function renderContacts() {
    const contactsList = document.getElementById('contacts-list');
    contactsList.innerHTML = contacts.map(contact => `
        <div class="contact-card" onclick="editContact('${contact.id}')">
            <div class="contact-name">${contact.name}</div>
            <div class="contact-info">${contact.phone}</div>
            <div class="contact-info">${contact.approach}</div>
        </div>
    `).join('');
}

function updateContactSelect() {
    const select = document.getElementById('contact-select');
    select.innerHTML = `
        <option value="">Selecione um contato</option>
        ${contacts.map(contact => `
            <option value="${contact.id}">${contact.name}</option>
        `).join('')}
    `;
}

function setCurrentWeek() {
    currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());
    updateWeekDisplay();
    renderCalendar();
}

function updateWeekDisplay() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const formatDate = (date) => date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });

    document.getElementById('current-week').textContent =
        `${formatDate(currentWeekStart)} - ${formatDate(weekEnd)}`;
}

function renderCalendar() {
    const calendar = document.getElementById('calendar');
    calendar.innerHTML = '';

    for (let i = 0; i < 7; i++) {
        const date = new Date(currentWeekStart);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        // Filtra os agendamentos para este dia, incluindo recorrentes
        const dayAppointments = appointments.filter(apt => {
            const aptDate = new Date(apt.date + "T00:00:00"); // Garante que a data seja interpretada corretamente
            if (apt.date === dateStr) return true;
            if (apt.isRecurring && aptDate.getDay() === date.getDay()) return true;
            return false;
        });
        

        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        dayElement.onclick = () => openAppointmentModal(dateStr);

        dayElement.innerHTML = `
            <div class="calendar-day-header">
                ${date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' })}
            </div>
            ${dayAppointments.map(apt => {
                const contact = contacts.find(c => c.id === apt.contactId);
                return `
                    <div class="appointment ${apt.isPaid ? 'paid' : 'unpaid'}"
                         onclick="editAppointment('${apt.id}', event)">
                        <div class="appointment-time">
                            ${apt.time}
                            ${apt.isRecurring ? '<span class="recurring-icon">🔄</span>' : ''}
                        </div>
                        <div class="appointment-contact">${contact ? contact.name : 'Contato removido'}</div>
                        <div class="appointment-actions">
                            <button onclick="deleteAppointment('${apt.id}', event)" 
                                    class="delete-btn">
                                🗑️ Excluir
                            </button>
                            <button onclick="sendWhatsAppConfirmation('${apt.id}', event)" 
                                    class="whatsapp-btn">
                                📱 Confirmar
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
        `;

        calendar.appendChild(dayElement);
    }
}

// Navegação do calendário
function previousWeek() {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    updateWeekDisplay();
    renderCalendar();
}

function nextWeek() {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    updateWeekDisplay();
    renderCalendar();
}

// Funções do Modal de Contato
function openContactModal() {
    document.getElementById('contact-modal').style.display = 'block';
    document.getElementById('contact-modal-title').textContent = 'Adicionar Contato';
    document.getElementById('contact-form').reset();
    document.getElementById('contact-id').value = '';
}

function closeContactModal() {
    document.getElementById('contact-modal').style.display = 'none';
}

function editContact(id) {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;

    document.getElementById('contact-modal-title').textContent = 'Editar Contato';
    document.getElementById('contact-id').value = contact.id;
    document.getElementById('name').value = contact.name;
    document.getElementById('phone').value = contact.phone;
    document.getElementById('approach').value = contact.approach;
    document.getElementById('contact-modal').style.display = 'block';
}

async function deleteContact(contactId, event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!confirm('Tem certeza que deseja excluir este contato? Todos os agendamentos associados também serão removidos.')) {
        return;
    }

    try {
        const response = await fetch(`/api/contacts/${contactId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadContacts();
            await loadAppointments();
            closeContactModal();
        }
    } catch (error) {
        console.error('Erro ao excluir contato:', error);
    }
}

async function handleContactSubmit(event) {
    event.preventDefault();

    const contactId = document.getElementById('contact-id').value;
    const contactData = {
        name: document.getElementById('name').value,
        phone: document.getElementById('phone').value,
        approach: document.getElementById('approach').value
    };

    try {
        let response;
        if (contactId) {
            response = await fetch(`/api/contacts/${contactId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contactData)
            });
        } else {
            response = await fetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contactData)
            });
        }

        if (response.ok) {
            closeContactModal();
            loadContacts();
        }
    } catch (error) {
        console.error('Erro ao salvar contato:', error);
    }
}

// Funções do Modal de Agendamento
function openAppointmentModal(date) {
    document.getElementById('appointment-modal').style.display = 'block';
    document.getElementById('appointment-modal-title').textContent = 'Agendar Consulta';
    document.getElementById('appointment-form').reset();
    document.getElementById('appointment-id').value = '';
    document.getElementById('appointment-date').value = date;
}

function closeAppointmentModal() {
    document.getElementById('appointment-modal').style.display = 'none';
}

function editAppointment(id, event) {
    event.stopPropagation();
    const appointment = appointments.find(a => a.id === id);
    if (!appointment) return;

    document.getElementById('appointment-modal-title').textContent = 'Editar Consulta';
    document.getElementById('appointment-id').value = appointment.id;
    document.getElementById('appointment-date').value = appointment.date;
    document.getElementById('contact-select').value = appointment.contactId;
    document.getElementById('time').value = appointment.time;
    document.getElementById('is-paid').checked = appointment.isPaid;
    document.getElementById('is-recurring').checked = appointment.isRecurring;
    document.getElementById('appointment-modal').style.display = 'block';
}

async function deleteAppointment(id, event) {
    event.preventDefault();
    event.stopPropagation();
    
    //if (!confirm('Tem certeza que deseja excluir este agendamento?')) {
    //    return;
    //}

    try {
        const response = await fetch(`/api/appointments/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadAppointments();
            closeAppointmentModal();
        }
    } catch (error) {
        console.error('Erro ao excluir agendamento:', error);
    }
}

async function handleAppointmentSubmit(event) {
    event.preventDefault();

    const appointmentId = document.getElementById('appointment-id').value;
    const appointmentData = {
        contactId: document.getElementById('contact-select').value,
        date: document.getElementById('appointment-date').value,
        time: document.getElementById('time').value,
        isPaid: document.getElementById('is-paid').checked,
        isRecurring: document.getElementById('is-recurring').checked
    };

    try {
        let response;
        if (appointmentId) {
            response = await fetch(`/api/appointments/${appointmentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appointmentData)
            });
        } else {
            response = await fetch('/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appointmentData)
            });
        }

        if (response.ok) {
            closeAppointmentModal();
            loadAppointments();
        }
    } catch (error) {
        console.error('Erro ao salvar agendamento:', error);
    }
}

// Função para enviar confirmação via WhatsApp
function sendWhatsAppConfirmation(appointmentId, event) {
    event.stopPropagation();
    const appointment = appointments.find(a => a.id === appointmentId);
    const contact = contacts.find(c => c.id === appointment.contactId);

    if (!contact) return;

    // Usando '\n' para garantir que encodeURIComponent converta corretamente para %0A
    const message = encodeURIComponent(
        `Oi ${contact.name}, boa tarde, como vc está hj?\n` +
        `Espero que esteja bem😉😉 .\n` +
        `Confirma nossa sessão hj às ${appointment.time}?`
    );

    const phone = contact.phone.replace(/\D/g, '');
    window.open(`https://api.whatsapp.com/send?phone=55${phone}&text=${message}`, '_blank');
}

// Fecha o modal ao pressionar esc ou clicar fora
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeContactModal();
        closeAppointmentModal();
    }
});

document.addEventListener('click', event => {
    if (event.target === document.getElementById('contact-modal') || 
        event.target === document.getElementById('appointment-modal')) {
        closeContactModal();
        closeAppointmentModal();
    }
});
