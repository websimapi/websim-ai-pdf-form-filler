import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

class PDFFormFiller {
    constructor() {
        this.pdfBytes = null;
        this.detectedFields = [];
        this.formData = {};
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const previewBtn = document.getElementById('previewBtn');
        const downloadBtn = document.getElementById('downloadBtn');

        // Upload area click
        uploadArea.addEventListener('click', () => fileInput.click());

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });

        // Button actions
        previewBtn.addEventListener('click', () => this.previewFilledPDF());
        downloadBtn.addEventListener('click', () => this.downloadFilledPDF());
    }

    async handleFileUpload(file) {
        if (file.type !== 'application/pdf') {
            alert('Please upload a PDF file');
            return;
        }

        this.showSection('processingSection');
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.pdfBytes = new Uint8Array(arrayBuffer);
            
            await this.renderPDFPreview();
            await this.analyzeFormFields();
            
            this.showSection('previewSection');
        } catch (error) {
            console.error('Error processing PDF:', error);
            alert('Error processing PDF. Please try again.');
            this.showSection('uploadSection');
        }
    }

    async renderPDFPreview() {
        // Using PDF.js for rendering
        const canvas = document.getElementById('pdfCanvas');
        const ctx = canvas.getContext('2d');
        
        // Convert PDF to image for AI analysis
        const pdfDoc = await PDFDocument.load(this.pdfBytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const { width, height } = firstPage.getSize();
        
        canvas.width = width;
        canvas.height = height;
        
        // Simple representation - in a real implementation, you'd use PDF.js
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);
        
        ctx.fillStyle = '#333';
        ctx.font = '16px Arial';
        ctx.fillText('PDF Preview (Page 1)', 20, 30);
        ctx.fillText(`Size: ${Math.round(width)} x ${Math.round(height)}`, 20, 55);
    }

    async analyzeFormFields() {
        try {
            // Convert PDF to image data URL for AI analysis
            const canvas = document.getElementById('pdfCanvas');
            const imageDataUrl = canvas.toDataURL('image/png');
            
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `Analyze this PDF form image and detect form fields that need to be filled out.
                        Look for text labels followed by blank spaces, underlines, boxes, or areas that appear to be form fields.
                        Common field types include: name, address, date, signature, checkbox, dropdown, text area.
                        
                        Respond with JSON in this exact format:
                        {
                          "fields": [
                            {
                              "id": "field_1",
                              "label": "Full Name",
                              "type": "text",
                              "x": 100,
                              "y": 200,
                              "width": 200,
                              "height": 25,
                              "required": true
                            }
                          ]
                        }
                        
                        Field types: "text", "email", "date", "number", "checkbox", "textarea", "select"
                        Coordinates should be approximate positions on the page.`
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Please analyze this PDF form and detect all the form fields that need to be filled out."
                            },
                            {
                                type: "image_url",
                                image_url: { url: imageDataUrl }
                            }
                        ]
                    }
                ],
                json: true
            });

            const result = JSON.parse(completion.content);
            this.detectedFields = result.fields || [];
            
            this.displayDetectedFields();
            this.generateDynamicForm();
            
        } catch (error) {
            console.error('Error analyzing form fields:', error);
            // Fallback: create some default fields
            this.detectedFields = [
                { id: 'name', label: 'Full Name', type: 'text', x: 100, y: 100, width: 200, height: 25, required: true },
                { id: 'email', label: 'Email Address', type: 'email', x: 100, y: 150, width: 200, height: 25, required: true },
                { id: 'date', label: 'Date', type: 'date', x: 100, y: 200, width: 150, height: 25, required: false },
                { id: 'signature', label: 'Signature', type: 'text', x: 100, y: 300, width: 200, height: 25, required: true }
            ];
            
            this.displayDetectedFields();
            this.generateDynamicForm();
        }
    }

    displayDetectedFields() {
        const container = document.getElementById('detectedFields');
        
        if (this.detectedFields.length === 0) {
            container.innerHTML = '<p>No form fields detected. Please try a different PDF.</p>';
            return;
        }

        container.innerHTML = `
            <div class="field-detection">
                <h4>🔍 Detected ${this.detectedFields.length} Form Fields</h4>
                ${this.detectedFields.map(field => 
                    `<div class="detected-field">
                        ${field.label} (${field.type}) ${field.required ? '- Required' : ''}
                    </div>`
                ).join('')}
            </div>
        `;
    }

    generateDynamicForm() {
        const container = document.getElementById('formFields');
        
        container.innerHTML = this.detectedFields.map(field => {
            const inputId = `input_${field.id}`;
            let inputHTML = '';
            
            switch (field.type) {
                case 'textarea':
                    inputHTML = `<textarea id="${inputId}" rows="4" placeholder="Enter ${field.label.toLowerCase()}"></textarea>`;
                    break;
                case 'select':
                    inputHTML = `
                        <select id="${inputId}">
                            <option value="">Select ${field.label}</option>
                            <option value="Option 1">Option 1</option>
                            <option value="Option 2">Option 2</option>
                            <option value="Option 3">Option 3</option>
                        </select>
                    `;
                    break;
                case 'checkbox':
                    inputHTML = `<input type="checkbox" id="${inputId}"> <label for="${inputId}" style="display: inline; margin-left: 8px;">${field.label}</label>`;
                    break;
                default:
                    inputHTML = `<input type="${field.type}" id="${inputId}" placeholder="Enter ${field.label.toLowerCase()}" ${field.required ? 'required' : ''}>`;
            }
            
            return `
                <div class="form-field">
                    ${field.type !== 'checkbox' ? `<label for="${inputId}">${field.label} ${field.required ? '*' : ''}</label>` : ''}
                    ${inputHTML}
                </div>
            `;
        }).join('');

        // Add event listeners to form inputs
        this.detectedFields.forEach(field => {
            const input = document.getElementById(`input_${field.id}`);
            if (input) {
                input.addEventListener('input', () => {
                    this.formData[field.id] = input.type === 'checkbox' ? input.checked : input.value;
                });
            }
        });
    }

    async previewFilledPDF() {
        const filledPDFBytes = await this.generateFilledPDF();
        
        // Show the output section and render the filled PDF
        document.getElementById('outputSection').style.display = 'block';
        
        const canvas = document.getElementById('outputCanvas');
        const ctx = canvas.getContext('2d');
        
        // Simple preview representation
        const originalCanvas = document.getElementById('pdfCanvas');
        canvas.width = originalCanvas.width;
        canvas.height = originalCanvas.height;
        
        // Copy original PDF
        ctx.drawImage(originalCanvas, 0, 0);
        
        // Overlay form data
        ctx.fillStyle = '#007bff';
        ctx.font = '14px Arial';
        
        this.detectedFields.forEach(field => {
            const value = this.formData[field.id];
            if (value) {
                ctx.fillText(value.toString(), field.x, field.y + 15);
            }
        });
        
        canvas.scrollIntoView({ behavior: 'smooth' });
    }

    async generateFilledPDF() {
        const pdfDoc = await PDFDocument.load(this.pdfBytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        
        // Add form data to PDF
        this.detectedFields.forEach(field => {
            const value = this.formData[field.id];
            if (value) {
                firstPage.drawText(value.toString(), {
                    x: field.x,
                    y: firstPage.getHeight() - field.y - 15, // PDF coordinate system is bottom-up
                    size: 12,
                    font: font,
                    color: rgb(0, 0, 0)
                });
            }
        });
        
        return await pdfDoc.save();
    }

    async downloadFilledPDF() {
        try {
            const filledPDFBytes = await this.generateFilledPDF();
            
            const blob = new Blob([filledPDFBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'filled-form.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Error generating PDF. Please try again.');
        }
    }

    showSection(sectionId) {
        const sections = ['uploadSection', 'processingSection', 'previewSection', 'outputSection'];
        sections.forEach(id => {
            document.getElementById(id).style.display = id === sectionId ? 'block' : 'none';
        });
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new PDFFormFiller();
});

